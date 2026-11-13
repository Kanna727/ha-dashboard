import { useSyncExternalStore } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { MONEY_PEOPLE } from '../config/entities';
import { store } from '../ha/store';
import { financeIds, findFinance, type Finance } from '../lib/finance';
import { mergeFinance } from '../lib/financePeople';
import { picked, useMoneyPerson } from './person';

// One memo for every reader (the page's panels, the Home tile, Needs attention):
// power sensors update the store every second, so it only rescans the finance
// helpers when an entity came or went or one of them changed. Each person in
// FINANCE.people has their own helpers (prefix); each view ('all' or one
// person) is added up once per change.
let memo: { count: number; ids: string[]; refs: (HassEntity | undefined)[]; views: Map<string, Finance | undefined> } | undefined;

function snapshot(sel: string): Finance | undefined {
  const all = store.getAll();
  const count = Object.keys(all).length;
  if (!memo || memo.count !== count || !memo.ids.every((id, i) => all[id] === memo!.refs[i])) {
    const ids = MONEY_PEOPLE.flatMap((p) => financeIds(all, p.prefix));
    memo = { count, ids, refs: ids.map((id) => all[id]), views: new Map() };
  }
  if (!memo.views.has(sel)) {
    memo.views.set(sel, mergeFinance(picked(sel).map((i) => ({ owner: MONEY_PEOPLE[i].id, data: findFinance(all, MONEY_PEOPLE[i].prefix) }))));
  }
  return memo.views.get(sel);
}

// The Money page's choice of person (money/person.ts).
export function useFinance(person?: string) {
  const current = useMoneyPerson();
  const sel = person ?? current;
  return useSyncExternalStore(store.subscribe, () => snapshot(sel));
}
// Everyone's, whatever the page shows (the Home tile, Needs attention, the Planner).
export const useHouseholdFinance = () => useFinance('all');
export const useHasMoney = () => !!useHouseholdFinance();
