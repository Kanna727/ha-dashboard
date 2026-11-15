import { useMemo } from 'react';
import { MONEY_PEOPLE } from '../config/entities';
import { parseMoneyHistory, type MoneyHistory } from '../lib/finance';
import { parseActivity, parseSnapshot, type Activity, type Snapshot } from '../lib/financeDetail';
import { mergeActivity, mergeHistory, mergeSnapshot, type Owned } from '../lib/financePeople';
import { useStoreDoc } from '../storage';
import { picked, useMoneyPerson } from './person';

// The hidden storage dashboards (the money sync's daily documents, the owner's
// own edits, medicines, habits, ...) are read and saved through storage/ (one
// engine per document: loaded once for every reader, followed live, with a local
// copy, and saved with conflict handling). These two names are kept so the many
// callers needn't change.
export { useSaveStoreDoc, useStoreDoc } from '../storage';

// Each person's document of a kind (MONEY_PEOPLE has a fixed length, so the
// hooks are always called in the same order). The sync writes all three kinds,
// the dashboard only reads them.
function usePeopleDocs(kind: 'store' | 'snapshotStore' | 'activityStore', cacheKey: string): unknown[] {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return MONEY_PEOPLE.map((p, i) => useStoreDoc(p[kind], i === 0 ? cacheKey : `${cacheKey}-${p.id}`, { readOnly: true }));
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
