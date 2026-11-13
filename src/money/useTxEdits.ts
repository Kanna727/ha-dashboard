import { useCallback, useMemo } from 'react';
import { FINANCE, MONEY_PEOPLE } from '../config/entities';
import { useNow } from '../hooks/useNow';
import { applyEdits, editsDoc, monthAdjust, parseEdits, type TxEdits, type ViewTx } from '../lib/txEdits';
import { useFinance } from './useFinance';
import { useMoneyPerson } from './person';
import { useActivity, useSaveStoreDoc, useStoreDoc } from './useMoneyHistory';

// The owner's changes to the transactions (lib/txEdits.ts): Home Assistant is
// the source of truth, nothing goes back to the money app. Stored in the hidden
// FINANCE.editsStore dashboard, which the dashboard creates on the first save.

export function useTxEdits(): TxEdits {
  const doc = useStoreDoc(FINANCE.editsStore, 'MoneyEdits');
  return useMemo(() => parseEdits(doc), [doc]);
}

// The transactions as shown: synced ones with the owner's changes, plus the
// ones they added (hidden ones flagged, not removed).
// With more than one person, only the chosen person's (one added before there
// was a list, with no owner, is the first person's).
export function useTxView(person?: string): ViewTx[] {
  const a = useActivity('all');
  const e = useTxEdits();
  const current = useMoneyPerson();
  const sel = person ?? current;
  const all = useMemo(() => applyEdits(a.transactions, e), [a.transactions, e]);
  return useMemo(() => (sel === 'all' ? all : all.filter((t) => (t.owner ?? MONEY_PEOPLE[0].id) === sel)), [all, sel]);
}

export function useSaveTxEdits(): (change: (e: TxEdits) => TxEdits) => Promise<void> {
  const save = useSaveStoreDoc(FINANCE.editsStore, 'MoneyEdits', 'Money edits');
  return useCallback((change) => save((current) => editsDoc(change(parseEdits(current)))), [save]);
}

// How the owner's changes move a month's spending ("YYYY-MM"): add it to the
// money app's totals.
export function useSpendAdjust(month: string, skip: string[] = [], person?: string) {
  const view = useTxView(person);
  const key = skip.join('|');
  return useMemo(() => monthAdjust(view, month, skip), [view, month, key]);
}

export function saveErrorText(e: unknown): string {
  const msg = String((e as { message?: unknown })?.message ?? e);
  return /unauthor|admin/i.test(msg) ? 'Only an admin login can save changes to Home Assistant.' : `Couldn’t save: ${msg}`;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// This month's spending: the money app's figure with the owner's changes.
// `person`: 'all' for everyone's whatever the page shows (the Home tile).
export function useSpentThisMonth(person?: string): number | undefined {
  const f = useFinance(person);
  const now = useNow(60_000);
  const adj = useSpendAdjust(monthKey(now), [], person);
  return f?.spentThisMonth === undefined ? undefined : Math.max(0, f.spentThisMonth + adj.total);
}
