import { useSyncExternalStore } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { FINANCE } from '../config/entities';
import { store } from '../ha/store';
import { financeIds, findFinance, type Finance } from '../lib/finance';

// One memo for every reader (the page's panels, the Home tile, Needs attention):
// power sensors update the store every second, so it only rescans the finance
// helpers when an entity came or went or one of them changed.
let memo: { count: number; ids: string[]; refs: (HassEntity | undefined)[]; f?: Finance } | undefined;

function snapshot(): Finance | undefined {
  const all = store.getAll();
  const count = Object.keys(all).length;
  if (memo && memo.count === count && memo.ids.every((id, i) => all[id] === memo!.refs[i])) return memo.f;
  const ids = financeIds(all, FINANCE.prefix);
  memo = { count, ids, refs: ids.map((id) => all[id]), f: findFinance(all, FINANCE.prefix) };
  return memo.f;
}

export const useFinance = () => useSyncExternalStore(store.subscribe, snapshot);
export const useHasMoney = () => !!useFinance();
