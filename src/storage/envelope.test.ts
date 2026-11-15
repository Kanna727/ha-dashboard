import { describe, expect, it } from 'vitest';
import { hasOp, newest, readMeta, revOf, sameJson, stamp, stripMeta, KEEP_OPS } from './envelope';

describe('the sync block', () => {
  it('is revision 0 on a document that never had one', () => {
    expect(readMeta({ a: 1 })).toBeNull();
    expect(revOf({ a: 1 })).toBe(0);
    expect(revOf(null)).toBe(0);
    expect(revOf([1, 2])).toBe(0);
  });

  it('is added by a save, one revision up, and removed for readers', () => {
    const first = stamp({ a: 1 }, null, [{ id: 'x', at: 1, by: 'tab' }], 'tab', 100);
    expect(readMeta(first)).toMatchObject({ rev: 1, by: 'tab', at: 100 });
    expect(stripMeta(first)).toEqual({ a: 1 });
    const second = stamp({ a: 2, _sync: { rev: 99 } }, readMeta(first), [{ id: 'y', at: 2, by: 'tab' }], 'tab', 200);
    expect(readMeta(second)?.rev).toBe(2);
    expect(hasOp(second, 'x')).toBe(true);
    expect(hasOp(second, 'y')).toBe(true);
  });

  it('keeps only the last few saves', () => {
    let doc: Record<string, unknown> = {};
    for (let i = 0; i < KEEP_OPS + 10; i++) doc = stamp(doc, readMeta(doc), [{ id: `op${i}`, at: i, by: 't' }], 't', i);
    expect(readMeta(doc)?.ops).toHaveLength(KEEP_OPS);
    expect(hasOp(doc, 'op0')).toBe(false);
    expect(hasOp(doc, `op${KEEP_OPS + 9}`)).toBe(true);
  });

  it('ignores a malformed block', () => {
    expect(readMeta({ _sync: 'nope' })).toBeNull();
    expect(readMeta({ _sync: { rev: 'one' } })).toBeNull();
    expect(readMeta({ _sync: { rev: 2, ops: [{ nope: 1 }, { id: 'ok' }, 5] } })?.ops.map((o) => o.id)).toEqual(['ok']);
  });

  it('leaves other kinds of document alone', () => {
    expect(stripMeta([1, 2])).toEqual([1, 2]);
    expect(stripMeta('x')).toBe('x');
    expect(stripMeta(null)).toBeNull();
    const plain = { a: 1 };
    expect(stripMeta(plain)).toBe(plain);
  });
});

describe('newest', () => {
  const at = (rev: number) => ({ _sync: { rev, ops: [] }, rev });
  it('takes the higher revision, the first on a tie, and the one that exists', () => {
    expect(newest(at(2), at(3))).toEqual(at(3));
    expect(newest(at(3), at(2))).toEqual(at(3));
    const a = at(2);
    expect(newest(a, at(2))).toBe(a);
    expect(newest(null, at(1))).toEqual(at(1));
    expect(newest(at(1), null)).toEqual(at(1));
    expect(newest(null, null)).toBeNull();
  });

  it('prefers any numbered copy to one without a number', () => {
    expect(newest({ plain: true }, at(1))).toEqual(at(1));
  });
});

describe('sameJson', () => {
  it('compares structure, not key order or undefined keys', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson([1, 2], [1])).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});
