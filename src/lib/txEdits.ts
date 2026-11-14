// The owner's own changes to the money app's transactions (2026-11-08: "the
// finance data inside Home Assistant should be the source of truth"; nothing
// is written back to the money app). Kept by the dashboard in a hidden storage
// dashboard (FINANCE.editsStore, default 'dashboard-money-edits') and laid over
// the synced transactions wherever they're shown or totalled:
//   { version: 2,
//     synced: { <key>: { note?, merchant?, amount?, t?, category?, sub?, account?, hidden?, orig, at } },
//     added:  [{ id, t, amount, note?, merchant?, category?, sub?, account?, at }] }
// A synced transaction has no id, so its key is when it happened, its signed
// amount and its account (`txKeys`), which the bank never changes; the money
// app's own re-tagging (merchant, category) doesn't move it. `orig` is the
// money app's transaction as it was when the owner changed it: the activity
// document only covers the last ~2 weeks, so once a transaction leaves it the
// change is still counted from this copy (the money app's month totals still
// hold the original, which the copy lets us take out). `amount` is signed
// (money out negative), `t` epoch ms. Pure helpers, unit-tested (txEdits.test.ts).
import { groupOf, isInvest, isMove, isTxGroup, type Tx, type TxGroup } from './financeDetail';

export interface TxPatch {
  group?: TxGroup;
  note?: string;
  merchant?: string;
  amount?: number;
  t?: number;
  category?: string;
  sub?: string;
  account?: string;
}
export interface SyncedEdit extends TxPatch {
  hidden?: boolean;
  orig: Tx;
  at: number;
}
export interface AddedTx extends TxPatch {
  id: string;
  t: number;
  amount: number;
  at: number;
}
export interface TxEdits {
  synced: Record<string, SyncedEdit>;
  added: AddedTx[];
}
// A transaction as shown: the synced one with the owner's changes, or one they added.
export interface ViewTx extends Tx {
  key: string;
  // The owner's name for it (shown as the title when set).
  note?: string;
  source: 'synced' | 'added';
  edited: boolean;
  hidden: boolean;
  // A changed synced transaction no longer in the activity document (older
  // than its window): still counted in totals, not listed.
  gone?: boolean;
  // The synced transaction before the owner's changes.
  orig?: Tx;
}

export const EMPTY_EDITS: TxEdits = { synced: {}, added: [] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

const PATCH_KEYS = ['note', 'merchant', 'category', 'sub', 'account'] as const;
function patchOf(v: unknown): TxPatch {
  const o = obj(v);
  const p: TxPatch = {};
  for (const k of PATCH_KEYS) if (str(o[k]) !== undefined) p[k] = str(o[k]);
  if (isTxGroup(o.group)) p.group = o.group;
  if (num(o.amount) !== undefined) p.amount = num(o.amount);
  if (num(o.t) !== undefined) p.t = num(o.t);
  return p;
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function origOf(v: unknown): Tx | undefined {
  const o = obj(v);
  const t = num(o.t);
  const amount = num(o.amount);
  if (t === undefined || amount === undefined) return undefined;
  const tx: Tx = { t, date: localDay(t), amount };
  for (const k of ['merchant', 'category', 'sub', 'account', 'notes'] as const) if (str(o[k])) tx[k] = str(o[k]);
  return tx;
}
// The copy kept with a change: only what the totals and the list need.
export const origCopy = (t: Tx): Tx => {
  const c: Tx = { t: t.t, date: t.date, amount: t.amount };
  for (const k of ['merchant', 'category', 'sub', 'account', 'notes'] as const) if (t[k]) c[k] = t[k];
  return c;
};

// Anything malformed is dropped rather than failing the page (a change without
// its original can't be counted, so it goes too).
export function parseEdits(doc: unknown): TxEdits {
  const d = obj(doc);
  const synced: TxEdits['synced'] = {};
  for (const [k, v] of Object.entries(obj(d.synced))) {
    const orig = origOf(obj(v).orig);
    if (!orig) continue;
    synced[k] = { ...patchOf(v), ...(obj(v).hidden === true ? { hidden: true } : {}), orig, at: num(obj(v).at) ?? 0 };
  }
  const added = (Array.isArray(d.added) ? d.added : [])
    .map((a): AddedTx | undefined => {
      const o = obj(a);
      const id = str(o.id);
      const t = num(o.t);
      const amount = num(o.amount);
      if (!id || t === undefined || amount === undefined || amount === 0) return undefined;
      return { ...patchOf(o), id, t, amount, at: num(o.at) ?? 0 };
    })
    .filter((a): a is AddedTx => !!a);
  return { synced, added };
}

export const editsDoc = (e: TxEdits) => ({ version: 2, synced: e.synced, added: e.added });

// Each synced transaction's key: "<epoch ms>|<signed amount>|<account>", with
// "#2", "#3" for look-alikes (same minute, amount and account) in list order.
export function txKeys(txs: Tx[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const base = `${t.t}|${t.amount.toFixed(2)}|${t.account ?? ''}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

// Empty strings in a patch clear the field.
const pick = (v: string | undefined, orig: string | undefined) => (v === undefined ? orig : v.trim() || undefined);
const hasPatch = (p: TxPatch) =>
  PATCH_KEYS.some((k) => p[k] !== undefined) || p.amount !== undefined || p.t !== undefined || p.group !== undefined;

function applyPatch(tx: Tx, p: TxPatch): Tx & { note?: string } {
  const t = p.t ?? tx.t;
  return {
    ...tx,
    t,
    date: localDay(t),
    amount: p.amount ?? tx.amount,
    merchant: pick(p.merchant, tx.merchant),
    category: pick(p.category, tx.category),
    sub: p.category !== undefined && p.sub === undefined ? undefined : pick(p.sub, tx.sub),
    account: pick(p.account, tx.account),
    note: p.note?.trim() || undefined,
    group: p.group ?? tx.group,
  };
}

// The synced transactions with the owner's changes, plus the ones they added,
// newest first. Hidden ones stay in the list, flagged (the card offers to show
// and unhide them); changed ones that have left the activity document come
// back from their copy, flagged `gone`.
export function applyEdits(txs: Tx[], e: TxEdits): ViewTx[] {
  const keys = txKeys(txs);
  const present = new Set(keys);
  const view = (key: string, tx: Tx, gone: boolean): ViewTx => {
    const s = e.synced[key];
    const edited = !!s && hasPatch(s);
    return { ...(s ? applyPatch(tx, s) : tx), key, source: 'synced', edited, hidden: !!s?.hidden, orig: tx, ...(gone ? { gone } : {}) };
  };
  const synced = txs.map((tx, i) => view(keys[i], tx, false));
  const gone = Object.entries(e.synced)
    .filter(([k]) => !present.has(k))
    .map(([k, s]) => view(k, s.orig, true));
  const added = e.added.map(
    (a): ViewTx => ({
      ...applyPatch({ t: a.t, date: localDay(a.t), amount: a.amount }, a),
      key: a.id,
      source: 'added',
      edited: false,
      hidden: false,
    }),
  );
  return [...synced, ...gone, ...added].sort((a, b) => b.t - a.t);
}

// What a transaction adds to a month's spending: money out that isn't a move
// between own accounts or a card bill payment, nor in a skipped category.
function spendOf(t: Tx, skip: Set<string>): number {
  if (t.amount >= 0 || isMove(t) || isInvest(t) || (t.category && skip.has(t.category.toLowerCase()))) return 0;
  return -t.amount;
}
const monthOf = (t: Tx) => t.date.slice(0, 7);

// How the owner's changes move a month's spending ("YYYY-MM"), in total and by
// category, compared with what the money app counted: an edit counts its new
// version in and its old one out, a hidden transaction comes out, an added
// one goes in. The money app's totals plus this are the page's totals.
export function monthAdjust(view: ViewTx[], month: string, skip: string[] = []): { total: number; byCategory: Map<string, number> } {
  const drop = new Set(skip.map((s) => s.toLowerCase()));
  const byCategory = new Map<string, number>();
  let total = 0;
  const add = (t: Tx, sign: 1 | -1) => {
    if (monthOf(t) !== month) return;
    const v = spendOf(t, drop) * sign;
    if (!v) return;
    total += v;
    const c = t.category ?? 'Untagged';
    byCategory.set(c, (byCategory.get(c) ?? 0) + v);
  };
  for (const t of view) {
    if (t.source === 'added') {
      if (!t.hidden) add(t, 1);
      continue;
    }
    if (!t.edited && !t.hidden) continue;
    add(t.orig!, -1);
    if (!t.hidden) add(t, 1);
  }
  return { total, byCategory };
}

// A month's categories ([name, amount], largest first) with the adjustment laid over.
export function adjustCategories(cats: [string, number][], adj: Map<string, number>): [string, number][] {
  const m = new Map(cats);
  for (const [k, v] of adj) m.set(k, (m.get(k) ?? 0) + v);
  return [...m.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
}

// ---- Changing the edits (each returns a new object) ----

// Sets (or with null, drops) the changes to a synced transaction, keeping it
// hidden if it was. `orig` is the money app's transaction now.
export function withChange(e: TxEdits, key: string, orig: Tx, patch: TxPatch | null, at = Date.now()): TxEdits {
  const synced = { ...e.synced };
  const hidden = !!synced[key]?.hidden;
  const p = patch ?? {};
  if (hasPatch(p) || hidden) synced[key] = { ...p, ...(hidden ? { hidden } : {}), orig: origCopy(orig), at };
  else delete synced[key];
  return { ...e, synced };
}

export function withHidden(e: TxEdits, key: string, orig: Tx, hide: boolean, at = Date.now()): TxEdits {
  const synced = { ...e.synced };
  const cur = synced[key];
  const patch: TxPatch = {};
  if (cur) for (const k of [...PATCH_KEYS, 'amount', 't', 'group'] as const) if (cur[k] !== undefined) (patch as Record<string, unknown>)[k] = cur[k];
  if (hide || hasPatch(patch)) synced[key] = { ...patch, ...(hide ? { hidden: true } : {}), orig: origCopy(orig), at };
  else delete synced[key];
  return { ...e, synced };
}

export function withAdded(e: TxEdits, tx: Omit<AddedTx, 'at'>, at = Date.now()): TxEdits {
  return { ...e, added: [...e.added.filter((a) => a.id !== tx.id), { ...tx, at }] };
}

export const withoutAdded = (e: TxEdits, id: string): TxEdits => ({ ...e, added: e.added.filter((a) => a.id !== id) });

// The fields that differ from the synced transaction: what an edit stores.
export function diffPatch(orig: Tx, next: TxPatch & { note?: string }, origNote?: string): TxPatch {
  const p: TxPatch = {};
  const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();
  if (next.note !== undefined && !same(next.note, origNote)) p.note = next.note.trim();
  if (next.merchant !== undefined && !same(next.merchant, orig.merchant)) p.merchant = next.merchant.trim();
  if (next.category !== undefined && !same(next.category, orig.category)) p.category = next.category.trim();
  if (next.sub !== undefined && !same(next.sub, orig.sub)) p.sub = next.sub.trim();
  if (next.account !== undefined && !same(next.account, orig.account)) p.account = next.account.trim();
  if (next.group !== undefined && next.group !== groupOf(orig)) p.group = next.group;
  if (next.amount !== undefined && Math.abs(next.amount - orig.amount) > 0.004) p.amount = next.amount;
  if (next.t !== undefined && Math.abs(next.t - orig.t) >= 60_000) p.t = next.t;
  return p;
}
