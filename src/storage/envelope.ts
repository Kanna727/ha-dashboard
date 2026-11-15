// Every document the dashboard writes to Home Assistant carries a small `_sync`
// block at its top level. HA's own save (lovelace/config/save) is last-write-wins
// with no revision check, so this is what lets two screens saving at once notice
// that one overwrote the other:
//   rev  counts the saves (it only goes up);
//   ops  the ids of the last saves, so a screen can tell whether its own save is
//        still in the document or was overwritten (see engine.ts);
//   by/at  which screen wrote it and when (for the diagnostics list).
// Documents without it (older ones, the money sync's) are revision 0. Readers
// never see the block: stripMeta removes it.
export const SYNC_KEY = '_sync';

export interface OpRecord {
  id: string;
  at: number;
  by: string;
}

export interface SyncMeta {
  rev: number;
  by: string;
  at: number;
  ops: OpRecord[];
}

// Enough to cover the seconds between a save and its check, however busy.
export const KEEP_OPS = 24;

export const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function readMeta(doc: unknown): SyncMeta | null {
  if (!isPlainObject(doc)) return null;
  const m = doc[SYNC_KEY];
  if (!isPlainObject(m) || typeof m.rev !== 'number' || !Number.isFinite(m.rev)) return null;
  const ops: OpRecord[] = [];
  if (Array.isArray(m.ops)) {
    for (const o of m.ops) {
      if (isPlainObject(o) && typeof o.id === 'string') ops.push({ id: o.id, at: Number(o.at) || 0, by: String(o.by ?? '') });
    }
  }
  return { rev: m.rev, by: String(m.by ?? ''), at: Number(m.at) || 0, ops };
}

export const revOf = (doc: unknown): number => readMeta(doc)?.rev ?? 0;

export const hasOp = (doc: unknown, id: string): boolean => !!readMeta(doc)?.ops.some((o) => o.id === id);

// The document as the app sees it. Anything that isn't an object (a document
// somebody else wrote as a list, say) passes through untouched.
export function stripMeta<T>(doc: T): T {
  if (!isPlainObject(doc) || !(SYNC_KEY in doc)) return doc;
  const { [SYNC_KEY]: _meta, ...rest } = doc;
  return rest as T;
}

// The document to store: `doc` with a revision one past `prev` and the ids of the
// saves it now contains added to the ones before.
export function stamp(doc: Record<string, unknown>, prev: SyncMeta | null, add: OpRecord[], by: string, at: number): Record<string, unknown> {
  const meta: SyncMeta = {
    rev: (prev?.rev ?? 0) + 1,
    by,
    at,
    ops: [...(prev?.ops ?? []), ...add].slice(-KEEP_OPS),
  };
  return { ...stripMeta(doc), [SYNC_KEY]: meta };
}

// Of two copies of one document (HA's dashboard and the inbox list), the newer;
// on a tie the first one. A missing copy loses.
export function newest(a: unknown, b: unknown): unknown {
  if (b === null || b === undefined) return a ?? null;
  if (a === null || a === undefined) return b;
  return revOf(b) > revOf(a) ? b : a;
}

// Structural equality for JSON data (key order doesn't matter).
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
