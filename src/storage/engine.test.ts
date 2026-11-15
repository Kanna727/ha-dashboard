import { describe, expect, it } from 'vitest';
import { createEngine, StorageError, type Backend, type DocEngine } from './engine';
import { readMeta } from './envelope';

// A tiny seeded generator, so the "random" delays are the same every run.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// HA's dashboard store: whoever writes last wins, and every call takes a moment.
function server(seed = 1, maxDelay = 4) {
  const rand = rng(seed);
  let doc: Record<string, unknown> | null = null;
  const subs = new Set<() => void>();
  const wait = () => new Promise<void>((r) => setTimeout(r, Math.floor(rand() * maxDelay)));
  const counts = { reads: 0, writes: 0 };
  const backend = (o: { deny?: boolean } = {}): Backend => ({
    async read() {
      await wait();
      counts.reads++;
      return doc ? structuredClone(doc) : null;
    },
    async write(d) {
      await wait();
      if (o.deny) throw Object.assign(new Error('Unauthorized'), { code: 'unauthorized' });
      counts.writes++;
      doc = structuredClone(d);
      subs.forEach((s) => s());
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  });
  return {
    backend,
    counts,
    get doc() {
      return doc;
    },
    set doc(d: Record<string, unknown> | null) {
      doc = d;
    },
  };
}

type Items = { items?: string[] };
const add = (item: string) => (cur: unknown) => ({ ...(cur as Items | null), items: [...((cur as Items | null)?.items ?? []), item] });
const itemsOf = (d: unknown): string[] => (d as Items | null)?.items ?? [];

function screen(name: string, primary: Backend, extra: Partial<Parameters<typeof createEngine>[0]> = {}, seed = 7): DocEngine {
  return createEngine({ primary, device: name, verifyAfterMs: 3, watchMs: 40, random: rng(seed), ...extra });
}

async function settle(...engines: DocEngine[]) {
  for (let round = 0; round < 12; round++) await Promise.all(engines.map((e) => e.flush()));
}

describe('saving applies the change to what is stored', () => {
  it('keeps both screens\' edits when the second one has not seen the first', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    const b = screen('b', srv.backend());
    await a.update(add('from a'));
    await b.update(add('from b')); // b never read a's save
    expect(itemsOf(srv.doc)).toEqual(['from a', 'from b']);
    expect(readMeta(srv.doc)?.rev).toBe(2);
  });

  it('hides the sync block from readers', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    expect(a.get()).toEqual({ items: ['x'] });
    expect(srv.doc).toHaveProperty('_sync');
  });

  it('writes nothing when the change leaves the document as it is', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    const writes = srv.counts.writes;
    await a.update((cur) => cur as object);
    expect(srv.counts.writes).toBe(writes);
  });

  it('rejects a change that is not an object', async () => {
    const a = screen('a', server().backend());
    await expect(a.update(() => [] as unknown as object)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses to save a document the dashboard only reads', async () => {
    const a = screen('a', server().backend(), { readOnly: true });
    await expect(a.update(add('x'))).rejects.toBeInstanceOf(StorageError);
    expect(a.status().canSave).toBe(false);
  });
});

describe('two screens saving at once', () => {
  it('lose nothing, even when HA keeps only the last write', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const srv = server(seed);
      const a = screen('a', srv.backend(), {}, seed);
      const b = screen('b', srv.backend(), {}, seed + 100);
      const mine = Array.from({ length: 8 }, (_, i) => `a${i}`);
      const theirs = Array.from({ length: 8 }, (_, i) => `b${i}`);
      await Promise.all([...mine.map((t) => a.update(add(t))), ...theirs.map((t) => b.update(add(t)))]);
      await settle(a, b);
      const stored = itemsOf(srv.doc);
      expect([...stored].sort()).toEqual([...mine, ...theirs].sort());
      expect(a.status().error).toBeUndefined();
      expect(b.status().error).toBeUndefined();
    }
  }, 60_000);

  it('count a save only once when the other screen overwrote it and it is applied again', async () => {
    const srv = server(9);
    const a = screen('a', srv.backend(), {}, 3);
    const b = screen('b', srv.backend(), {}, 4);
    await Promise.all([a.update(add('one')), b.update(add('two'))]);
    await settle(a, b);
    expect(itemsOf(srv.doc).filter((x) => x === 'one')).toHaveLength(1);
    expect(itemsOf(srv.doc).filter((x) => x === 'two')).toHaveLength(1);
  });

  it('three screens too', async () => {
    const srv = server(11, 3);
    const screens = ['a', 'b', 'c'].map((n, i) => screen(n, srv.backend(), {}, i + 20));
    const all: string[] = [];
    await Promise.all(
      screens.flatMap((s, si) =>
        Array.from({ length: 5 }, (_, i) => {
          const t = `${si}-${i}`;
          all.push(t);
          return s.update(add(t));
        }),
      ),
    );
    await settle(...screens);
    expect([...itemsOf(srv.doc)].sort()).toEqual(all.sort());
  });
});

describe('failures', () => {
  it('an overwritten save that never sticks is reported as a conflict', async () => {
    const real = server();
    // A store that acknowledges writes and then drops them.
    const lossy: Backend = { ...real.backend(), write: async () => undefined };
    const a = createEngine({ primary: lossy, device: 'a', verifyAfterMs: 1, maxAttempts: 3, random: rng(1) });
    await a.update(add('x'));
    await a.flush();
    expect(a.status().error?.code).toBe('conflict');
    expect(a.status().pending).toBe(0);
  });

  it('a save the network refused is an offline error and nothing is left to retry', async () => {
    const srv = server();
    const down: Backend = {
      ...srv.backend(),
      write: async () => {
        throw new Error('connection lost');
      },
    };
    const a = screen('a', down);
    await expect(a.update(add('x'))).rejects.toMatchObject({ code: 'offline' });
    expect(a.status().pending).toBe(0);
  });

  it('a write that landed but whose answer was lost is not saved twice', async () => {
    const srv = server();
    const inner = srv.backend();
    let first = true;
    const flaky: Backend = {
      ...inner,
      async write(d) {
        await inner.write(d);
        if (first) {
          first = false;
          throw new Error('connection reset');
        }
      },
    };
    const a = screen('a', flaky);
    await a.update(add('x'));
    await a.flush();
    expect(itemsOf(srv.doc)).toEqual(['x']);
  });

  it('keeps the document it has when a read comes back empty', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    srv.doc = null;
    await a.refresh();
    expect(itemsOf(a.get())).toEqual(['x']);
  });

  it('ignores an older answer arriving after a newer save', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    await a.update(add('y'));
    const stale = structuredClone(srv.doc) as Record<string, unknown>;
    (stale._sync as { rev: number }).rev = 1;
    stale.items = ['x'];
    srv.doc = stale;
    await a.refresh();
    expect(itemsOf(a.get())).toEqual(['x', 'y']);
  });

  it('takes a document somebody else wrote without a revision', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    srv.doc = { items: ['from the sync'] };
    await a.refresh();
    expect(itemsOf(a.get())).toEqual(['from the sync']);
  });
});

describe('a login that cannot write the dashboard store', () => {
  it('saves into the inbox, and an admin screen moves it across', async () => {
    const dash = server(1);
    const inbox = server(2);
    const viewer = screen('viewer', dash.backend({ deny: true }), { inbox: inbox.backend() });
    const admin = screen('admin', dash.backend(), { inbox: inbox.backend() });

    await viewer.update(add('from the viewer'));
    expect(itemsOf(inbox.doc)).toEqual(['from the viewer']);
    expect(dash.doc).toBeNull();
    expect(viewer.status()).toMatchObject({ via: 'inbox', canSave: true });

    await admin.refresh();
    await new Promise((r) => setTimeout(r, 15));
    expect(itemsOf(admin.get())).toEqual(['from the viewer']);
    expect(itemsOf(dash.doc)).toEqual(['from the viewer']);
  });

  it('reads whichever copy is newer', async () => {
    const dash = server(1);
    const inbox = server(2);
    const admin = screen('admin', dash.backend(), { inbox: inbox.backend() });
    const viewer = screen('viewer', dash.backend({ deny: true }), { inbox: inbox.backend() });
    await admin.update(add('one'));
    await viewer.update(add('two')); // goes to the inbox, on top of "one"
    expect(itemsOf(inbox.doc)).toEqual(['one', 'two']);
    await admin.update(add('three')); // reads the newer inbox copy, writes the dashboard
    expect(itemsOf(dash.doc)).toEqual(['one', 'two', 'three']);
  });

  it('says so when there is no inbox list to fall back on', async () => {
    const dash = server();
    const viewer = screen('viewer', dash.backend({ deny: true }));
    await expect(viewer.update(add('x'))).rejects.toMatchObject({ code: 'not-admin' });
    expect(viewer.status().canSave).toBe(false);
  });

  it('does not even try the dashboard store once the login is known to be a viewer', async () => {
    const dash = server();
    const inbox = server();
    const viewer = screen('viewer', dash.backend(), { inbox: inbox.backend(), isAdmin: () => false });
    await viewer.update(add('x'));
    expect(dash.counts.writes).toBe(0);
    expect(itemsOf(inbox.doc)).toEqual(['x']);
  });
});

describe('following a document', () => {
  it('loads once for everyone and follows other screens\' saves', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    const b = screen('b', srv.backend());
    let seen = 0;
    const stop = b.subscribe(() => seen++);
    await a.update(add('x'));
    await new Promise((r) => setTimeout(r, 20));
    expect(itemsOf(b.get())).toEqual(['x']);
    expect(seen).toBeGreaterThan(0);
    stop();
  });

  it('keeps the same document object while nothing changed', async () => {
    const srv = server();
    const a = screen('a', srv.backend());
    await a.update(add('x'));
    const before = a.get();
    await a.refresh();
    expect(a.get()).toBe(before);
  });
});
