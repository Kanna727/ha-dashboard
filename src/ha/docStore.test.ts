import { describe, expect, it, vi } from 'vitest';
import { createDocStore, type DocSource } from './docStore';

function fakeSource(docs: unknown[]) {
  const subs = new Set<() => void>();
  let i = 0;
  const source: DocSource & { fire: () => void; subs: Set<() => void> } = {
    fetchStore: vi.fn(async () => docs[Math.min(i++, docs.length - 1)]),
    subscribeStore: vi.fn((_: string, cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    fire: () => subs.forEach((cb) => cb()),
    subs,
  };
  return source;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createDocStore', () => {
  it('fetches once for every reader and tells each of them', async () => {
    const src = fakeSource([{ a: 1 }]);
    const saved: unknown[] = [];
    const store = createDocStore('dash', null, (d) => saved.push(d));
    const l1 = vi.fn();
    const l2 = vi.fn();
    store.subscribe(src, l1);
    store.subscribe(src, l2);
    await tick();
    expect(src.fetchStore).toHaveBeenCalledTimes(1);
    expect(src.subscribeStore).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ a: 1 });
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([{ a: 1 }]);
  });

  it('refetches on a live update and keeps the document on a null fetch', async () => {
    const src = fakeSource([{ v: 1 }, null, { v: 3 }]);
    const store = createDocStore('dash', { cached: true });
    store.subscribe(src, () => undefined);
    await tick();
    expect(store.get()).toEqual({ v: 1 });
    src.fire();
    await tick();
    expect(store.get()).toEqual({ v: 1 });
    src.fire();
    await tick();
    expect(store.get()).toEqual({ v: 3 });
  });

  it('starts with the cached copy and survives a failed fetch', async () => {
    const src: DocSource = { fetchStore: () => Promise.reject(new Error('down')), subscribeStore: () => () => undefined };
    const store = createDocStore('dash', { cached: true });
    store.subscribe(src, () => undefined);
    await tick();
    expect(store.get()).toEqual({ cached: true });
  });

  it('stops following when the last reader leaves, and starts again', async () => {
    const src = fakeSource([{ v: 1 }]);
    const store = createDocStore('dash', null);
    const off1 = store.subscribe(src, () => undefined);
    const off2 = store.subscribe(src, () => undefined);
    off1();
    expect(src.subs.size).toBe(1);
    off2();
    expect(src.subs.size).toBe(0);
    store.subscribe(src, () => undefined);
    expect(src.fetchStore).toHaveBeenCalledTimes(2);
    expect(src.subs.size).toBe(1);
  });

  it('ignores a fetch that lands after everyone left', async () => {
    let resolve!: (d: unknown) => void;
    const src: DocSource = { fetchStore: () => new Promise((r) => (resolve = r)), subscribeStore: () => () => undefined };
    const store = createDocStore('dash', 'old');
    const off = store.subscribe(src, () => undefined);
    off();
    resolve('late');
    await tick();
    expect(store.get()).toBe('old');
  });

  it('takes a saved document at once', () => {
    const store = createDocStore('dash', null);
    const l = vi.fn();
    store.subscribe(fakeSource([null]), l);
    store.set({ saved: 1 });
    expect(store.get()).toEqual({ saved: 1 });
    expect(l).toHaveBeenCalled();
  });
});
