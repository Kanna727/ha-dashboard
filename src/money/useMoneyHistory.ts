import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { MONEY_PEOPLE } from '../config/entities';
import { useHass } from '../ha/api';
import { createDocStore, type DocStore } from '../ha/docStore';
import { readCache, writeCache } from '../ha/useRegistry';
import { parseMoneyHistory, type MoneyHistory } from '../lib/finance';
import { parseActivity, parseSnapshot, type Activity, type Snapshot } from '../lib/financeDetail';
import { mergeActivity, mergeHistory, mergeSnapshot, type Owned } from '../lib/financePeople';
import { picked, useMoneyPerson } from './person';

// The deployed preview shares the live dashboard's origin, so the mock keeps its own copies.
const PREFIX = import.meta.env.VITE_MOCK ? 'mock' : 'dash';

// Hidden storage dashboards (the money sync's daily documents and the owner's
// own edits), each loaded once for every reader and followed live
// (ha/docStore.ts), with a local copy so a reload draws at once. null until
// there is one (or when the login can't read it: the detail dashboards may be
// admin-only).
const stores = new Map<string, DocStore>();
function storeFor(urlPath: string, cacheKey: string): DocStore {
  let s = stores.get(urlPath);
  if (!s) {
    const key = `${PREFIX}${cacheKey}`;
    s = createDocStore(urlPath, readCache(key, null), (d) => writeCache(key, d));
    stores.set(urlPath, s);
  }
  return s;
}

export function useStoreDoc(urlPath: string, cacheKey: string): unknown {
  const hass = useHass();
  const s = storeFor(urlPath, cacheKey);
  const subscribe = useCallback((l: () => void) => s.subscribe(hass, l), [s, hass]);
  return useSyncExternalStore(subscribe, s.get);
}

// Saves a document the dashboard owns: re-reads the stored one first and
// applies `change` to it, so two screens editing at once don't undo each other.
// Needs an admin login (HA's lovelace/config/save).
export function useSaveStoreDoc(urlPath: string, cacheKey: string, title: string) {
  const hass = useHass();
  const s = storeFor(urlPath, cacheKey);
  return useCallback(
    async (change: (current: unknown) => object) => {
      const next = change(await hass.fetchStore(urlPath));
      await hass.saveStore(urlPath, next, title);
      s.set(next);
    },
    [hass, urlPath, title, s],
  );
}

// Each person's document of a kind (MONEY_PEOPLE has a fixed length, so the
// hooks are always called in the same order).
function usePeopleDocs(kind: 'store' | 'snapshotStore' | 'activityStore', cacheKey: string): unknown[] {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return MONEY_PEOPLE.map((p, i) => useStoreDoc(p[kind], i === 0 ? cacheKey : `${cacheKey}-${p.id}`));
}

// Parse each person's document, then add up the chosen ones ('all' or one id).
function usePeople<T>(kind: 'store' | 'snapshotStore' | 'activityStore', cacheKey: string, parse: (d: unknown) => T, merge: (l: Owned<T>[]) => T, sel: string): T {
  const docs = usePeopleDocs(kind, cacheKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => docs.map(parse), docs);
  return useMemo(() => merge(picked(sel).map((i) => ({ owner: MONEY_PEOPLE[i].id, data: parsed[i] }))), [parsed, sel, merge]);
}

// The charts' data (lib/finance.ts, parseMoneyHistory). Empty until the sync writes it.
export function useMoneyHistory(): MoneyHistory {
  return usePeople('store', 'MoneyHistory', parseMoneyHistory, mergeHistory, useMoneyPerson());
}
// Everyone's, whatever the Money page shows (the Planner's calendar).
export function useHouseholdMoneyHistory(): MoneyHistory {
  return usePeople('store', 'MoneyHistory', parseMoneyHistory, mergeHistory, 'all');
}

// Every card's limit and cycle, the score factors, EPF, funds, stocks,
// insurance, loans, recurring payments, this month by subcategory.
export function useSnapshot(): Snapshot {
  return usePeople('snapshotStore', 'MoneySnapshot', parseSnapshot, mergeSnapshot, useMoneyPerson());
}

// The last two weeks of transactions and the latest fund, stock and EPF entries.
export function useActivity(sel?: string): Activity {
  const current = useMoneyPerson();
  return usePeople('activityStore', 'MoneyActivity', parseActivity, mergeActivity, sel ?? current);
}
