import { useCallback, useMemo } from 'react';
import { FINANCE } from '../config/entities';
import { useNow } from '../hooks/useNow';
import { applyEdits, editsDoc, monthAdjust, parseEdits, type TxEdits, type ViewTx } from '../lib/txEdits';
import { useFinance } from './useFinance';
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
export function useTxView(): ViewTx[] {
  const a = useActivity();
  const e = useTxEdits();
  return useMemo(() => applyEdits(a.transactions, e), [a.transactions, e]);
}

export function useSaveTxEdits(): (change: (e: TxEdits) => TxEdits) => Promise<void> {
  const save = useSaveStoreDoc(FINANCE.editsStore, 'MoneyEdits', 'Money edits');
  return useCallback((change) => save((current) => editsDoc(change(parseEdits(current)))), [save]);
}

// How the owner's changes move a month's spending ("YYYY-MM"): add it to the
// money app's totals.
export function useSpendAdjust(month: string, skip: string[] = []) {
  const view = useTxView();
  const key = skip.join('|');
  return useMemo(() => monthAdjust(view, month, skip), [view, month, key]);
}

export function saveErrorText(e: unknown): string {
  const msg = String((e as { message?: unknown })?.message ?? e);
  return /unauthor|admin/i.test(msg) ? 'Only an admin login can save changes to Home Assistant.' : `Couldn’t save: ${msg}`;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// This month's spending: the money app's figure with the owner's changes.
export function useSpentThisMonth(): number | undefined {
  const f = useFinance();
  const now = useNow(60_000);
  const adj = useSpendAdjust(monthKey(now));
  return f?.spentThisMonth === undefined ? undefined : Math.max(0, f.spentThisMonth + adj.total);
}
