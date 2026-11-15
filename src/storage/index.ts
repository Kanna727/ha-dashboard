// The shared documents, as React hooks. Every document the dashboard keeps in
// Home Assistant (config, layout, medicines, habits, money edits, client names,
// and the ones the money sync writes) goes through here: one engine per document
// (engine.ts), loaded once for every reader and followed live, with a local copy
// so a reload draws at once. See "Shared storage" in AGENTS.md.
import { useCallback, useSyncExternalStore } from 'react';
import { STORAGE } from '../config/entities';
import { useHass, type HassApi } from '../ha/api';
import { store } from '../ha/store';
import { readCache, writeCache } from '../ha/useRegistry';
import { isAdmin } from './admin';
import { createEngine, NOT_ADMIN_TEXT, type Backend, type Change, type DocEngine, type DocStatus } from './engine';
import { DEFAULT_INBOX, todoInbox } from './inbox';

// The deployed preview shares the live dashboard's origin, so the mock keeps its own copies.
const PREFIX = import.meta.env.VITE_MOCK ? 'mock' : 'dash';

export interface DocOptions {
  // Shown in HA's dashboard list when the dashboard is created, and in diagnostics.
  title?: string;
  // Written by something else (the money sync): the dashboard never saves it.
  readOnly?: boolean;
  // Never save into the inbox list: only an admin may change this document (the config).
  noInbox?: boolean;
}

interface Entry {
  engine: DocEngine;
  title: string;
  readOnly: boolean;
}
const engines = new Map<string, Entry>();

function deviceId(): string {
  const key = `${PREFIX}Device`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 8);
  }
}

// Saves from one document run one at a time across the browser's tabs (Web Locks,
// secure pages only; elsewhere each tab is on its own and the engine's check
// catches the overlap).
function lockFor(path: string) {
  return <T,>(job: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? (locks.request(`dash-doc:${path}`, job) as unknown as Promise<T>) : job();
  };
}

function primaryOf(hass: HassApi, path: string, title: string): Backend {
  return {
    read: () => hass.fetchStore(path),
    write: (doc) => hass.saveStore(path, doc, title),
    subscribe: (cb) => hass.subscribeStore(path, cb),
  };
}

function inboxOf(hass: HassApi, path: string): Backend | null {
  const entity = STORAGE.inbox === false ? null : (STORAGE.inbox ?? DEFAULT_INBOX);
  return entity ? todoInbox(hass, entity, path, () => !!store.getAll()[entity]) : null;
}

export function engineFor(hass: HassApi, path: string, cacheKey: string, opts: DocOptions = {}): DocEngine {
  let entry = engines.get(path);
  if (!entry) {
    const title = opts.title ?? path;
    const key = `${PREFIX}${cacheKey}`;
    entry = {
      title,
      readOnly: !!opts.readOnly,
      engine: createEngine({
        primary: primaryOf(hass, path, title),
        inbox: opts.readOnly || opts.noInbox ? null : inboxOf(hass, path),
        initial: readCache(key, null),
        onDoc: (d) => writeCache(key, d),
        device: deviceId(),
        readOnly: opts.readOnly,
        isAdmin,
        lock: lockFor(path),
        onVisible: (cb) => {
          const on = () => document.visibilityState === 'visible' && cb();
          document.addEventListener('visibilitychange', on);
          return () => document.removeEventListener('visibilitychange', on);
        },
      }),
    };
    engines.set(path, entry);
  }
  return entry.engine;
}

// The document stored at `path` (the url_path of its hidden dashboard), without
// the sync block; null until there is one (or when this login can't read it:
// some of the money sync's documents are admin-only).
export function useStoreDoc(path: string, cacheKey: string, opts?: DocOptions): unknown {
  const hass = useHass();
  const engine = engineFor(hass, path, cacheKey, opts);
  return useSyncExternalStore(engine.subscribe, engine.get);
}

// Saves a change to a document the dashboard owns. `change` gets the document as
// stored right now and returns the new one; it runs again on the newer document
// if another screen's save overwrote this one, so it must depend on nothing but
// its argument. Needs an admin login unless the inbox list exists (inbox.ts).
export function useSaveStoreDoc(path: string, cacheKey: string, title: string, opts?: DocOptions): (change: Change) => Promise<void> {
  const hass = useHass();
  const engine = engineFor(hass, path, cacheKey, { title, ...opts });
  return useCallback((change) => engine.update(change), [engine]);
}

// How saving that document is going (loaded, saving, retrying, which copy, who last wrote).
export function useDocStatus(path: string, cacheKey: string, opts?: DocOptions): DocStatus {
  const hass = useHass();
  const engine = engineFor(hass, path, cacheKey, opts);
  return useSyncExternalStore(engine.subscribe, engine.status);
}

// Every document opened so far, for the diagnostics list.
export function openDocs(): { path: string; title: string; readOnly: boolean; status: DocStatus }[] {
  return [...engines].map(([path, e]) => ({ path, title: e.title, readOnly: e.readOnly, status: e.engine.status() }));
}

// What to tell the person when a save failed.
export function saveErrorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'not-admin' || code === 'unauthorized') return NOT_ADMIN_TEXT;
  if (code === 'offline') return 'Couldn’t reach Home Assistant, so this wasn’t saved. Try again.';
  if (code === 'conflict') return 'Another screen kept overwriting this change, so it wasn’t saved. Try again.';
  const msg = String((e as { message?: unknown } | null)?.message ?? e);
  return /unauthor|admin/i.test(msg) ? NOT_ADMIN_TEXT : `Couldn’t save: ${msg}`;
}

export { StorageError, NOT_ADMIN_TEXT } from './engine';
export type { DocStatus } from './engine';
