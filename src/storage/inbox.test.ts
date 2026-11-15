import { describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '../ha/api';
import { createEngine } from './engine';
import { todoInbox, type InboxHass } from './inbox';

// A Local To-do list as HA keeps it: items with a uid, a summary and a description.
function fakeList() {
  let items: TodoItem[] = [];
  let n = 0;
  const subs = new Set<(i: TodoItem[]) => void>();
  const push = () => subs.forEach((s) => s(items));
  const hass: InboxHass = {
    fetchTodo: vi.fn(async () => items),
    subscribeTodo: vi.fn((_id, cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }),
    callService: vi.fn(async (_d, service, data = {}) => {
      if (service === 'add_item') items = [...items, { uid: `u${++n}`, summary: String(data.item), status: 'needs_action', description: String(data.description) }];
      else if (service === 'update_item') items = items.map((i) => (i.uid === data.item || i.summary === data.item ? { ...i, description: String(data.description) } : i));
      push();
      return {};
    }),
  };
  return { hass, items: () => items };
}

describe('the inbox list', () => {
  it('keeps one item per document, the document as its description', async () => {
    const list = fakeList();
    const inbox = todoInbox(list.hass, 'todo.dashboard_data', 'dashboard-names', () => true);
    expect(await inbox.read()).toBeNull();
    await inbox.write({ clients: { a: 1 } });
    await inbox.write({ clients: { a: 2 } });
    expect(list.items()).toHaveLength(1);
    expect(list.items()[0].summary).toBe('dashboard-names');
    expect(await inbox.read()).toEqual({ clients: { a: 2 } });
  });

  it('keeps documents apart', async () => {
    const list = fakeList();
    const a = todoInbox(list.hass, 'todo.dashboard_data', 'a', () => true);
    const b = todoInbox(list.hass, 'todo.dashboard_data', 'b', () => true);
    await a.write({ v: 'a' });
    await b.write({ v: 'b' });
    expect(await a.read()).toEqual({ v: 'a' });
    expect(await b.read()).toEqual({ v: 'b' });
    expect(list.items()).toHaveLength(2);
  });

  it('reads nothing from a description that is not a JSON object', async () => {
    const list = fakeList();
    await list.hass.callService('todo', 'add_item', { item: 'k', description: 'not json' });
    const inbox = todoInbox(list.hass, 'todo.dashboard_data', 'k', () => true);
    expect(await inbox.read()).toBeNull();
    await list.hass.callService('todo', 'update_item', { item: 'k', description: '[1,2]' });
    expect(await inbox.read()).toBeNull();
  });

  it('does nothing while the list does not exist, and refuses to save', async () => {
    const list = fakeList();
    const inbox = todoInbox(list.hass, 'todo.dashboard_data', 'k', () => false);
    expect(await inbox.read()).toBeNull();
    expect(list.hass.fetchTodo).not.toHaveBeenCalled();
    await expect(inbox.write({ a: 1 })).rejects.toMatchObject({ code: 'not-admin' });
  });

  it('tells followers when anything on the list changes', async () => {
    const list = fakeList();
    const inbox = todoInbox(list.hass, 'todo.dashboard_data', 'k', () => true);
    const cb = vi.fn();
    const stop = inbox.subscribe?.(cb);
    await inbox.write({ a: 1 });
    expect(cb).toHaveBeenCalled();
    stop?.();
  });

  it('is what a non-admin screen saves into, and a later read finds', async () => {
    const list = fakeList();
    const refused = { read: async () => null, write: async () => Promise.reject(Object.assign(new Error('Unauthorized'), { code: 'unauthorized' })) };
    const viewer = createEngine({ primary: refused, inbox: todoInbox(list.hass, 'todo.dashboard_data', 'doc', () => true), device: 'v', verifyAfterMs: 1, watchMs: 5 });
    await viewer.update((cur) => ({ ...(cur as object), saved: 'by a viewer' }));
    await viewer.flush();
    const other = createEngine({ primary: refused, inbox: todoInbox(list.hass, 'todo.dashboard_data', 'doc', () => true), device: 'o' });
    await other.refresh();
    expect(other.get()).toEqual({ saved: 'by a viewer' });
  });
});
