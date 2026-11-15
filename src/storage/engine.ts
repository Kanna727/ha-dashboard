// One shared document, kept in Home Assistant and followed live on every screen.
// No React here, so it's unit-tested (engine.test.ts).
//
// Saving is "apply this change to the document as it is now", never "replace it
// with what I had": `update(change)` reads the stored document, runs `change` on
// it, stamps the result (envelope.ts) and writes it. HA's save is last-write-wins,
// so two screens saving within one round trip can still overwrite each other. The
// stamp lets the loser find out: a little later every save is checked against the
// stored document, and one whose id is gone is run again on what's stored now.
// `change` must therefore be a pure function of the document it is given.
//
// A login that may not write the primary store (non-admin: lovelace/config/save is
// admin-only) saves into an "inbox" backend instead (a Local To-do list, see
// inbox.ts) that any login can write. Reads take whichever copy has the higher
// revision, and an admin screen that sees a newer inbox copy moves it into the
// primary store.
import { hasOp, isPlainObject, newest, readMeta, revOf, sameJson, stamp, stripMeta } from './envelope';

export type StorageErrorCode = 'not-admin' | 'read-only' | 'offline' | 'invalid' | 'conflict';

export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const NOT_ADMIN_TEXT = 'Only an admin login can save changes to Home Assistant.';

// HA answers a write it won't allow with code "unauthorized".
export function isDenied(e: unknown): boolean {
  if (e instanceof StorageError) return e.code === 'not-admin';
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'unauthorized') return true;
  return /unauthori[sz]ed|admin/i.test(String((e as { message?: unknown } | null)?.message ?? ''));
}

const messageOf = (e: unknown): string => String((e as { message?: unknown } | null)?.message ?? e);

// Where one copy of a document lives. `read` resolves null for "no such document yet".
export interface Backend {
  read(): Promise<unknown | null>;
  write(doc: Record<string, unknown>): Promise<void>;
  // Calls back whenever anyone saves it.
  subscribe?(cb: () => void): () => void;
}

export type Change = (current: unknown) => object;

export interface DocStatus {
  // The first read has answered (until then the document is this device's copy).
  loaded: boolean;
  // Saves written but not yet confirmed to be in the stored document.
  pending: number;
  // A save was overwritten by another screen and is being applied again.
  retrying: boolean;
  // The last save that couldn't be kept.
  error?: StorageError;
  // Where this screen's saves go.
  via: 'dashboard' | 'inbox';
  // Whether this screen can save at all: false for a document the dashboard only
  // reads, and for a non-admin login with no inbox list to save into.
  canSave: boolean;
  rev: number;
  by?: string;
  at?: number;
}

export interface DocEngine {
  // The document without the sync block; null until there is one.
  get(): unknown;
  status(): DocStatus;
  // Follows the document while there is at least one listener.
  subscribe(listener: () => void): () => void;
  update(change: Change): Promise<void>;
  refresh(): Promise<void>;
  // Checks every save now, applying again any that were overwritten, until all are
  // confirmed (or given up on). For tests, and before leaving the page.
  flush(): Promise<void>;
}

export interface EngineOptions {
  primary: Backend;
  inbox?: Backend | null;
  // The local copy (what the last visit stored), shown until HA answers.
  initial?: unknown;
  // Called with each new document, to keep the local copy.
  onDoc?: (doc: unknown) => void;
  // Names this screen in the sync block.
  device: string;
  readOnly?: boolean;
  // Whether this login may write the primary store, once known (from the user).
  isAdmin?: () => boolean | undefined;
  // First check of a save after this long; later checks back off (x2 each) until
  // `watchMs` after the save, because a slow write from another screen can land
  // and wipe out a save that was already confirmed.
  verifyAfterMs?: number;
  watchMs?: number;
  maxAttempts?: number;
  // Runs a job exclusively across the page's tabs (Web Locks); default: no lock.
  lock?: <T>(job: () => Promise<T>) => Promise<T>;
  now?: () => number;
  newId?: () => string;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  // Also refetch when the page becomes visible again (a sleeping screen misses events).
  onVisible?: (cb: () => void) => () => void;
}

const defaultId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function createEngine(o: EngineOptions): DocEngine {
  const verifyAfter = o.verifyAfterMs ?? 1200;
  const watchMs = o.watchMs ?? 30_000;
  const maxAttempts = o.maxAttempts ?? 6;
  const now = o.now ?? Date.now;
  const newId = o.newId ?? defaultId;
  const random = o.random ?? Math.random;
  const lock = o.lock ?? (<T,>(job: () => Promise<T>) => job());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  // As stored, with the sync block; `doc` is the same without it.
  let raw: unknown = o.initial ?? null;
  let doc: unknown = stripMeta(raw);
  let learnedWrite: boolean | undefined;
  let viaInbox = false;
  let loaded = false;
  let retrying = false;
  let error: StorageError | undefined;
  let lastStatus: DocStatus | undefined;

  const pending = new Map<string, { change: Change; attempts: number; born: number }>();
  let cycle = 0;
  const listeners = new Set<() => void>();
  let tail: Promise<unknown> = Promise.resolve();
  let verifyTimer: unknown;
  let stopFollowing: (() => void) | undefined;
  let refreshing: Promise<void> | undefined;
  let refreshAgain = false;

  const canWritePrimary = (): boolean | undefined => o.isAdmin?.() ?? learnedWrite;

  const status = (): DocStatus => {
    const meta = readMeta(raw);
    const w = canWritePrimary();
    const canSave = o.readOnly ? false : w === false ? !!o.inbox : true;
    const next: DocStatus = {
      loaded,
      pending: pending.size,
      retrying,
      error,
      via: w === false ? 'inbox' : viaInbox ? 'inbox' : 'dashboard',
      canSave,
      rev: meta?.rev ?? 0,
      by: meta?.by,
      at: meta?.at,
    };
    // Keep the same object while nothing changed (useSyncExternalStore).
    if (lastStatus && sameJson(lastStatus, next) && lastStatus.error === next.error) return lastStatus;
    lastStatus = next;
    return next;
  };

  const notify = () => listeners.forEach((l) => l());

  // Takes an answer from the store as the current document.
  const adopt = (next: unknown): void => {
    const before = lastStatus;
    let changed = false;
    const r = revOf(next);
    // An older answer arriving late (a document without a revision is someone
    // else's write and always counts).
    if (!(r > 0 && r < revOf(raw)) && next !== null && next !== undefined) {
      raw = next;
      const stripped = stripMeta(next);
      if (!sameJson(stripped, doc)) {
        doc = stripped;
        changed = true;
        o.onDoc?.(doc);
      }
    }
    loaded = true;
    if (changed || before !== status()) notify();
  };

  const readBest = async (): Promise<{ best: unknown; fromInbox: boolean }> => {
    const [p, i] = await Promise.all([o.primary.read(), o.inbox ? o.inbox.read().catch(() => null) : Promise.resolve(null)]);
    const best = newest(p, i);
    return { best, fromInbox: best !== null && best === i && best !== p };
  };

  const doRefresh = async (): Promise<void> => {
    try {
      const { best, fromInbox } = await readBest();
      adopt(best);
      // An admin screen moves the inbox copy into the primary store.
      if (fromInbox && best && canWritePrimary() !== false) {
        o.primary.write(best as Record<string, unknown>).then(
          () => {
            learnedWrite = true;
          },
          (e) => {
            if (isDenied(e)) {
              learnedWrite = false;
              notify();
            }
          },
        );
      }
    } catch {
      // keep what we have
    }
  };

  const refresh = (): Promise<void> => {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = doRefresh().finally(() => {
      refreshing = undefined;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    });
    return refreshing;
  };

  const writeStamped = async (id: string, stamped: Record<string, unknown>): Promise<void> => {
    const toInbox = async () => {
      if (!o.inbox) throw new StorageError('not-admin', NOT_ADMIN_TEXT);
      viaInbox = true;
      try {
        await o.inbox.write(stamped);
      } catch (e) {
        if (isDenied(e)) throw new StorageError('not-admin', NOT_ADMIN_TEXT);
        throw e;
      }
    };
    if (canWritePrimary() === false) return toInbox();
    try {
      await o.primary.write(stamped);
      learnedWrite = true;
      viaInbox = false;
    } catch (e) {
      if (isDenied(e)) {
        learnedWrite = false;
        return toInbox();
      }
      // The answer may have been lost on the way back: did it land?
      try {
        if (hasOp((await o.primary.read()) as unknown, id)) return;
      } catch {
        // still offline
      }
      throw e;
    }
  };

  // One try at making `change` part of the stored document.
  const attempt = async (id: string, change: Change): Promise<'written' | 'present' | 'noop'> => {
    let best: unknown;
    try {
      best = (await readBest()).best;
    } catch (e) {
      throw new StorageError('offline', messageOf(e));
    }
    if (hasOp(best, id)) {
      adopt(best);
      return 'present';
    }
    const prev = readMeta(best);
    const base = best === null ? null : stripMeta(best);
    const next = change(base);
    if (!isPlainObject(next)) throw new StorageError('invalid', 'A shared document must be an object.');
    if (best !== null && sameJson(stripMeta(next), base)) {
      adopt(best);
      return 'noop';
    }
    const stamped = stamp(next, prev, [{ id, at: now(), by: o.device }], o.device, now());
    try {
      await writeStamped(id, stamped);
    } catch (e) {
      if (e instanceof StorageError) throw e;
      throw new StorageError('offline', messageOf(e));
    }
    adopt(stamped);
    return 'written';
  };

  // Jobs run one at a time here, and one at a time across the page's tabs.
  const serial = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(
      () => lock(job),
      () => lock(job),
    );
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const scheduleVerify = () => {
    if (verifyTimer !== undefined) return;
    const wait = Math.min(verifyAfter * 2 ** cycle, Math.max(verifyAfter, 10_000)) * (1 + 0.5 * random());
    verifyTimer = setTimer(() => {
      verifyTimer = undefined;
      void verifyNow();
    }, wait);
  };

  // Checks every save still being watched against the stored document and applies
  // again any that are gone. `force` ends the watch of the ones that are there.
  const verifyNow = (force = false): Promise<void> =>
    serial(async () => {
      if (!pending.size) return;
      let best: unknown;
      try {
        best = (await readBest()).best;
      } catch {
        scheduleVerify();
        return;
      }
      adopt(best);
      const lost: string[] = [];
      for (const [id, p] of [...pending]) {
        if (!hasOp(best, id)) lost.push(id);
        else if (force || now() - p.born >= watchMs) pending.delete(id);
      }
      retrying = lost.length > 0;
      for (const id of lost) {
        const p = pending.get(id);
        if (!p) continue;
        if (p.attempts >= maxAttempts) {
          pending.delete(id);
          error = new StorageError('conflict', 'A change was overwritten by another screen too many times and was not kept.');
          continue;
        }
        p.attempts++;
        try {
          if ((await attempt(id, p.change)) !== 'written') pending.delete(id);
          else p.born = now();
        } catch (e) {
          pending.delete(id);
          error = e instanceof StorageError ? e : new StorageError('offline', messageOf(e));
        }
      }
      if (pending.size) {
        cycle = lost.length ? 0 : cycle + 1;
        scheduleVerify();
      } else retrying = false;
      notify();
    });

  const update = (change: Change): Promise<void> => {
    if (o.readOnly) return Promise.reject(new StorageError('read-only', 'This document is written by something else; the dashboard only reads it.'));
    const id = newId();
    return serial(async () => {
      error = undefined;
      const result = await attempt(id, change);
      if (result === 'written') {
        pending.set(id, { change, attempts: 1, born: now() });
        cycle = 0;
        scheduleVerify();
      }
      notify();
    });
  };

  const flush = async (): Promise<void> => {
    for (let i = 0; i < maxAttempts * 2 + 2 && pending.size; i++) {
      if (verifyTimer !== undefined) {
        clearTimer(verifyTimer);
        verifyTimer = undefined;
      }
      await verifyNow(true);
    }
    if (!pending.size && verifyTimer !== undefined) {
      clearTimer(verifyTimer);
      verifyTimer = undefined;
    }
  };

  const start = () => {
    void refresh();
    const subs = [o.primary.subscribe?.(() => void refresh()), o.inbox?.subscribe?.(() => void refresh()), o.onVisible?.(() => void refresh())];
    stopFollowing = () => subs.forEach((u) => u?.());
  };

  return {
    get: () => doc,
    status,
    subscribe(listener) {
      listeners.add(listener);
      if (!stopFollowing) start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size && stopFollowing) {
          stopFollowing();
          stopFollowing = undefined;
        }
      };
    },
    update,
    refresh,
    flush,
  };
}
