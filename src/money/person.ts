import { useSyncExternalStore } from 'react';
import { MONEY_PEOPLE } from '../config/entities';

// Whose money the Money page shows: 'all' (everyone added up) or one
// FINANCE.people id. Remembered per device. With one person there's no choice.
const KEY = 'moneyPerson';
export const MANY_PEOPLE = MONEY_PEOPLE.length > 1;

let current = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && MONEY_PEOPLE.some((p) => p.id === v) ? v : 'all';
  } catch {
    return 'all';
  }
})();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useMoneyPerson = () => useSyncExternalStore(subscribe, () => (MANY_PEOPLE ? current : 'all'));

export function setMoneyPerson(next: string) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage blocked: this visit only */
  }
  listeners.forEach((l) => l());
}

// The person's name, for the owner tags.
export const personName = (id: string | undefined) => MONEY_PEOPLE.find((p) => p.id === id)?.name ?? '';
// Their indices into MONEY_PEOPLE for a selection.
export const picked = (sel: string) => MONEY_PEOPLE.map((p, i) => (sel === 'all' || p.id === sel ? i : -1)).filter((i) => i >= 0);
