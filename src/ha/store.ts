import { useRef, useSyncExternalStore } from 'react';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

// Minimal external store so a power sensor ticking every second only
// re-renders the components that read it, not the whole tree.
export class EntityStore {
  private states: HassEntities = {};
  private listeners = new Set<() => void>();

  getAll = (): HassEntities => this.states;

  set(next: HassEntities) {
    this.states = next;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const store = new EntityStore();

export function useEntity(id: string | undefined): HassEntity | undefined {
  return useSyncExternalStore(store.subscribe, () => (id ? store.getAll()[id] : undefined));
}

export function useEntities(ids: readonly string[]): (HassEntity | undefined)[] {
  const cache = useRef<(HassEntity | undefined)[]>([]);
  return useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const next = ids.map((id) => all[id]);
    const prev = cache.current;
    if (prev.length === next.length && prev.every((e, i) => e === next[i])) return prev;
    cache.current = next;
    return next;
  });
}

export function useAllEntities(): HassEntities {
  return useSyncExternalStore(store.subscribe, store.getAll);
}
