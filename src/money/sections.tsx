import { useSyncExternalStore } from 'react';

// The Money page in five sections (the owner found fourteen cards on one page
// too many, 2026-11-08). It opens on a tile per section ("Tiles, then drill
// in", picked by the owner the same day from four designs); tapping a tile
// shows that section's cards (unchanged), with a strip of small tiles to switch
// or go back. Layouts.tsx puts the cards in each section; MoneyTiles.tsx draws
// the tiles and the strip.
export type MoneySection = 'overview' | 'spending' | 'cards' | 'invest' | 'insurance';

export const MONEY_SECTIONS: { id: MoneySection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'spending', label: 'Spending' },
  { id: 'cards', label: 'Cards' },
  { id: 'invest', label: 'Investments' },
  { id: 'insurance', label: 'Insurance' },
];

// null: the tiles. Leaving the Money page goes back to the tiles, so it always
// opens on them (the calm view for the wall).
let current: MoneySection | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('hashchange', () => {
    if (current !== null && window.location.hash !== '#money') {
      current = null;
      emit();
    }
  });
}

export function setMoneySection(s: MoneySection | null) {
  if (s === current) return;
  current = s;
  emit();
  window.scrollTo({ top: 0 });
}

export const useMoneySection = () => useSyncExternalStore(subscribe, () => current);
