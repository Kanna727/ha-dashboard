import { describe, expect, it } from 'vitest';
import { applyPatches, diff, getAt, moveItem, pathText, removeAt, setAt } from './draft';

describe('paths', () => {
  it('reads and writes without touching the original', () => {
    const a = { ROOMS: [{ name: 'Kitchen', controls: [{ entity: 'light.a' }] }], X: 1 };
    const b = setAt(a, ['ROOMS', 0, 'controls', 0, 'entity'], 'light.b');
    expect(getAt(b, ['ROOMS', 0, 'controls', 0, 'entity'])).toBe('light.b');
    expect(getAt(a, ['ROOMS', 0, 'controls', 0, 'entity'])).toBe('light.a');
    expect(b.X).toBe(1);
  });

  it('creates what is missing on the way', () => {
    expect(setAt({}, ['A', 'b', 'c'], 1)).toEqual({ A: { b: { c: 1 } } });
    expect(setAt({}, ['L', 1], 'x')).toEqual({ L: [undefined, 'x'] });
    expect(setAt(undefined, ['A'], 1)).toEqual({ A: 1 });
  });

  it('removes object keys and array elements', () => {
    expect(removeAt({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
    expect(removeAt({ l: [1, 2, 3] }, ['l', 1])).toEqual({ l: [1, 3] });
    expect(setAt({ a: 1 }, ['a'], undefined)).toEqual({});
  });

  it('moves a list item', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    const same = [1, 2];
    expect(moveItem(same, 0, 5)).toBe(same);
  });

  it('writes a path as text', () => {
    expect(pathText(['ROOMS', 2, 'controls', 0, 'entity'])).toBe('ROOMS[2].controls[0].entity');
    expect(pathText([])).toBe('');
  });
});

describe('patches', () => {
  const base = { A: { x: 1, y: 2 }, L: [1, 2], S: 'a', gone: true };

  it('are the changed leaves, lists as a whole', () => {
    const draft = { A: { x: 1, y: 3 }, L: [1, 2, 3], S: 'a' };
    expect(diff(base, draft)).toEqual([
      { path: ['A', 'y'], value: 3 },
      { path: ['L'], value: [1, 2, 3] },
      { path: ['gone'], del: true },
    ]);
  });

  it('are empty for no change', () => {
    expect(diff(base, structuredClone(base))).toEqual([]);
  });

  it('reproduce the draft when applied to the base', () => {
    const draft = { A: { x: 9 }, L: [], S: 'b', added: { deep: [1] } };
    expect(applyPatches(base, diff(base, draft))).toEqual(draft);
  });

  it('applied to a config somebody else changed meanwhile keep both edits', () => {
    const mine = { ...base, S: 'mine' };
    const theirs = { ...base, A: { x: 1, y: 'theirs' } };
    expect(applyPatches(theirs, diff(base, mine))).toEqual({ A: { x: 1, y: 'theirs' }, L: [1, 2], S: 'mine', gone: true });
  });

  it('start from nothing when there is no stored config yet', () => {
    expect(applyPatches({}, diff({}, { A: { x: 1 } }))).toEqual({ A: { x: 1 } });
  });
});
