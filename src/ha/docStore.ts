// One hidden storage dashboard's document, loaded once for every reader and
// followed live (money/useMoneyHistory.ts wraps it in hooks). The first
// subscriber starts the fetch and the live subscription, the last one to leave
// stops it; a null fetch (no such dashboard yet, or one this login can't read)
// keeps what is already there. No React here, so it's unit-tested
// (docStore.test.ts).
export interface DocSource {
  fetchStore(urlPath: string): Promise<unknown | null>;
  subscribeStore(urlPath: string, cb: () => void): () => void;
}

export interface DocStore {
  get(): unknown;
  subscribe(source: DocSource, listener: () => void): () => void;
  // A document just saved (no need to wait for the refetch).
  set(doc: unknown): void;
}

export function createDocStore(urlPath: string, initial: unknown, onDoc?: (doc: unknown) => void): DocStore {
  let doc = initial;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (d: unknown) => {
    doc = d;
    onDoc?.(d);
    listeners.forEach((l) => l());
  };
  return {
    get: () => doc,
    set,
    subscribe(source, listener) {
      listeners.add(listener);
      if (!stop) {
        let live = true;
        const load = () =>
          source
            .fetchStore(urlPath)
            .then((d) => live && d !== null && set(d))
            .catch(() => undefined);
        void load();
        const unsub = source.subscribeStore(urlPath, load);
        stop = () => {
          live = false;
          unsub();
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && stop) {
          stop();
          stop = undefined;
        }
      };
    },
  };
}
