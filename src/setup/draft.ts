// Editing helpers for the config draft: immutable get/set/remove by path, and
// the difference between two configs as patches. Saving applies only the
// editor's own patches to the config as it is stored right now, so two admins
// changing different settings don't undo each other (see useConfigSave.ts).
import { isPlainObject, sameJson } from '../storage/envelope';

export type Path = (string | number)[];

export const pathText = (path: Path): string => path.reduce<string>((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${k}` : k), '');

export function getAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

// A copy of `root` with `value` at `path`; containers on the way are created
// (an array for a number key, else an object). `undefined` removes an object key.
export function setAt<T>(root: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const base: unknown = root ?? (typeof k === 'number' ? [] : {});
  if (Array.isArray(base)) {
    const next = [...base];
    next[k as number] = setAt(base[k as number], rest, value);
    return next as T;
  }
  const obj = { ...(base as Record<string, unknown>) };
  const child = setAt(obj[k as string], rest, value);
  if (child === undefined && !rest.length) delete obj[k as string];
  else obj[k as string] = child;
  return obj as T;
}

// A copy without the object key or array element at `path`.
export function removeAt<T>(root: T, path: Path): T {
  if (!path.length) return root;
  const parent = getAt(root, path.slice(0, -1));
  const k = path[path.length - 1];
  if (Array.isArray(parent)) return setAt(root, path.slice(0, -1), parent.filter((_, i) => i !== k));
  return setAt(root, path, undefined);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export interface Patch {
  path: string[];
  // The new value; missing with `del` when the key was removed.
  value?: unknown;
  del?: true;
}

// What changed from `base` to `draft`: objects are compared key by key, anything
// else (a list, a number) is replaced as a whole.
export function diff(base: unknown, draft: unknown, path: string[] = []): Patch[] {
  if (sameJson(base, draft)) return [];
  if (isPlainObject(base) && isPlainObject(draft)) {
    const out: Patch[] = [];
    for (const k of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      if (draft[k] === undefined && base[k] !== undefined) out.push({ path: [...path, k], del: true });
      else out.push(...diff(base[k], draft[k], [...path, k]));
    }
    return out;
  }
  return [{ path, value: draft }];
}

export function applyPatches<T>(root: T, patches: Patch[]): T {
  return patches.reduce((cur, p) => (p.del ? removeAt(cur, p.path) : setAt(cur, p.path, p.value)), root);
}
