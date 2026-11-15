// The inbox: a second place for a shared document, for logins that may not write
// HA's dashboard store (lovelace/config/save is admin-only). It is a Local To-do
// list that any login can change: one item per document, the item's summary is
// the document's name and its description the document as JSON. engine.ts reads
// both copies and takes the newer; an admin screen moves a newer inbox copy into
// the dashboard store.
//
// The list is optional. Without it a non-admin login can read everything and
// save nothing, as before. Create it once in HA (Settings → Devices & services →
// Add integration → Local To-do, named "Dashboard data" → `todo.dashboard_data`),
// or point STORAGE.inbox at another list.
import type { TodoItem } from '../ha/api';
import { StorageError, type Backend } from './engine';
import { isPlainObject } from './envelope';

export const DEFAULT_INBOX = 'todo.dashboard_data';

// What the inbox needs from the HA connection.
export interface InboxHass {
  fetchTodo(entityId: string): Promise<TodoItem[]>;
  subscribeTodo(entityId: string, cb: (items: TodoItem[]) => void): () => void;
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: { entity_id?: string | string[] }): Promise<unknown>;
}

export function todoInbox(hass: InboxHass, entityId: string, key: string, exists: () => boolean): Backend {
  const find = (items: TodoItem[]) => items.find((i) => i.summary === key);
  return {
    async read() {
      if (!exists()) return null;
      const item = find(await hass.fetchTodo(entityId));
      if (!item?.description) return null;
      try {
        const v: unknown = JSON.parse(item.description);
        return isPlainObject(v) ? v : null;
      } catch {
        return null;
      }
    },
    async write(doc) {
      if (!exists()) throw new StorageError('not-admin', 'No inbox list to save into.');
      const description = JSON.stringify(doc);
      const item = find(await hass.fetchTodo(entityId));
      if (item) await hass.callService('todo', 'update_item', { item: item.uid, description }, { entity_id: entityId });
      else await hass.callService('todo', 'add_item', { item: key, description }, { entity_id: entityId });
    },
    subscribe(cb) {
      if (!exists()) return () => undefined;
      return hass.subscribeTodo(entityId, () => cb());
    },
  };
}
