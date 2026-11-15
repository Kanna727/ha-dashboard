// Whether the setup editor is open: a tiny module store, so the top bar's button
// and a ?setup link can open it from anywhere.
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  if (open === v) return;
  open = v;
  listeners.forEach((l) => l());
};

export const openSetup = () => set(true);
export const closeSetup = () => set(false);

export function useSetupOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
