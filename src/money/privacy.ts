import { useSyncExternalStore } from 'react';
import { FINANCE } from '../config/entities';

// Amounts on the Money page can be blurred: the wall screens show them to
// anyone in the room. On FINANCE.hide layouts (default the tablet) they start
// blurred, and the eye button or a tap on an amount shows them for PEEK_MS.
// Elsewhere they show, and the eye button hides them (remembered per device).
const PEEK_MS = 5 * 60_000;
const KEY = 'moneyHidden';

let layout = '';
let peekUntil = 0;
let timer: number | undefined;
let stored = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// App sets the layout before paint (useLayoutEffect).
export function setMoneyLayout(next: string) {
  if (next === layout) return;
  layout = next;
  emit();
}

const hidesByDefault = () => FINANCE.hide.includes(layout);
const isHidden = () => (hidesByDefault() ? Date.now() >= peekUntil : stored);

export const useAmountsHidden = () => useSyncExternalStore(subscribe, isHidden);

export function toggleAmounts() {
  if (hidesByDefault()) {
    window.clearTimeout(timer);
    peekUntil = isHidden() ? Date.now() + PEEK_MS : 0;
    if (peekUntil) timer = window.setTimeout(emit, PEEK_MS);
  } else {
    stored = !stored;
    try {
      localStorage.setItem(KEY, stored ? '1' : '0');
    } catch {
      /* storage blocked: this visit only */
    }
  }
  emit();
}
