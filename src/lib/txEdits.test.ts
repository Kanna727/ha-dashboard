import { describe, expect, it } from 'vitest';
import type { Tx } from './financeDetail';
import { adjustCategories, applyEdits, diffPatch, editsDoc, EMPTY_EDITS, monthAdjust, parseEdits, txKeys, withAdded, withChange, withHidden, withoutAdded } from './txEdits';

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const tx = (t: number, amount: number, merchant: string, category?: string, account = 'Kotak ••4410'): Tx => {
  const d = new Date(t);
  return { t, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, amount, merchant, category, account };
};

const cafe = tx(at(2026, 11, 5, 10, 20), -340, 'Corner Cafe', 'Food & Drinks');
const fuel = tx(at(2026, 11, 3, 15, 54), -1000, 'City Fuels', 'Transport');
const twin = tx(at(2026, 11, 3, 15, 54), -1000, 'City Fuels', 'Transport');
const salary = tx(at(2026, 11, 1, 9), 98000, 'ACME', 'Salary');
const move = tx(at(2026, 11, 2), -20000, 'Myself', 'Self Transfer');
const oct = tx(at(2026, 10, 30), -500, 'ShopKart', 'Shopping');
const txs = [cafe, fuel, twin, move, salary, oct];
const keys = txKeys(txs);

describe('txKeys', () => {
  it('keys by time, signed amount and account, numbering look-alikes', () => {
    expect(keys[0]).toBe(`${cafe.t}|-340.00|Kotak ••4410`);
    expect(keys[2]).toBe(`${keys[1]}#2`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('parseEdits', () => {
  it('keeps what is well formed and drops the rest', () => {
    const e = parseEdits({
      version: 2,
      synced: {
        a: { note: 'Dinner', amount: -300, at: 5, junk: 1, orig: { t: 1, amount: -250, merchant: 'X', extra: 1 } },
        b: { note: 'no original', at: 1 },
        c: { hidden: true, orig: { t: 2, amount: -5 } },
      },
      added: [{ id: 'n1', t: 1, amount: -50 }, { id: 'n2', t: 1, amount: 0 }, { t: 1, amount: 5 }],
    });
    expect(e.synced.a).toMatchObject({ note: 'Dinner', amount: -300, at: 5, orig: { t: 1, amount: -250, merchant: 'X' } });
    expect(e.synced.a.orig).not.toHaveProperty('extra');
    expect(e.synced.b).toBeUndefined();
    expect(e.synced.c.hidden).toBe(true);
    expect(e.added.map((a) => a.id)).toEqual(['n1']);
    expect(parseEdits(null)).toEqual(EMPTY_EDITS);
  });
  it('round-trips through the stored document', () => {
    const e = withAdded(withHidden(withChange(EMPTY_EDITS, keys[0], cafe, { note: 'Coffee' }, 1), keys[1], fuel, true, 2), { id: 'n1', t: 3, amount: -9 }, 3);
    expect(parseEdits(JSON.parse(JSON.stringify(editsDoc(e))))).toEqual(e);
  });
});

describe('applyEdits', () => {
  it('lays changes over, flags hidden, adds the added, newest first', () => {
    let e = withChange(EMPTY_EDITS, keys[0], cafe, { note: 'Coffee with Sam', amount: -400, category: 'Treats' }, 1);
    e = withHidden(e, keys[1], fuel, true, 2);
    e = withAdded(e, { id: 'n1', t: at(2026, 11, 6, 20), amount: -250, merchant: 'Chai Stall', category: 'Food & Drinks', account: 'Cash' }, 3);
    const v = applyEdits(txs, e);
    expect(v[0]).toMatchObject({ key: 'n1', source: 'added', merchant: 'Chai Stall', amount: -250, date: '2026-11-06' });
    const c = v.find((x) => x.key === keys[0])!;
    expect(c).toMatchObject({ note: 'Coffee with Sam', amount: -400, category: 'Treats', sub: undefined, edited: true, merchant: 'Corner Cafe' });
    expect(c.orig).toBe(cafe);
    expect(v.find((x) => x.key === keys[1])).toMatchObject({ hidden: true, edited: false });
    expect(v.find((x) => x.key === keys[2])!.hidden).toBe(false);
  });
  it('moves a transaction to another day', () => {
    const e = withChange(EMPTY_EDITS, keys[0], cafe, { t: at(2026, 10, 31, 9) });
    expect(applyEdits(txs, e).find((x) => x.key === keys[0])!.date).toBe('2026-10-31');
  });
  it('clears a field set to an empty string', () => {
    const e = withChange(EMPTY_EDITS, keys[0], cafe, { merchant: '', category: '' });
    expect(applyEdits(txs, e).find((x) => x.key === keys[0])).toMatchObject({ merchant: undefined, category: undefined });
  });
  it('brings back a changed transaction that has left the activity window, flagged gone', () => {
    const e = withChange(EMPTY_EDITS, keys[5], oct, { category: 'Gifts' });
    const v = applyEdits(txs.slice(0, 5), e);
    expect(v.find((x) => x.key === keys[5])).toMatchObject({ gone: true, category: 'Gifts', edited: true, merchant: 'ShopKart' });
    expect(applyEdits(txs, e).find((x) => x.key === keys[5])!.gone).toBeUndefined();
  });
});

describe('monthAdjust', () => {
  it('is zero without changes', () => {
    expect(monthAdjust(applyEdits(txs, EMPTY_EDITS), '2026-11').total).toBe(0);
  });
  it('counts the new version in and the old one out, by category', () => {
    let e = withChange(EMPTY_EDITS, keys[0], cafe, { amount: -400, category: 'Treats' });
    e = withHidden(e, keys[1], fuel, true);
    e = withAdded(e, { id: 'n1', t: at(2026, 11, 6), amount: -250, category: 'Food & Drinks' });
    e = withHidden(e, keys[3], move, true); // a move: never counted either way
    const a = monthAdjust(applyEdits(txs, e), '2026-11');
    expect(a.total).toBe(400 - 340 - 1000 + 250);
    expect(Object.fromEntries(a.byCategory)).toEqual({ 'Food & Drinks': -340 + 250, Treats: 400, Transport: -1000 });
  });
  it('keeps counting a change after the transaction leaves the activity window', () => {
    let e = withChange(EMPTY_EDITS, keys[5], oct, { amount: -800 });
    e = withHidden(e, keys[0], cafe, true);
    const later = applyEdits([], e); // nothing synced any more
    expect(monthAdjust(later, '2026-10').total).toBe(300);
    expect(monthAdjust(later, '2026-11').total).toBe(-340);
  });
  it('moves spending between months when the date changes', () => {
    const e = withChange(EMPTY_EDITS, keys[5], oct, { t: at(2026, 11, 1, 12) });
    const v = applyEdits(txs, e);
    expect(monthAdjust(v, '2026-10').total).toBe(-500);
    expect(monthAdjust(v, '2026-11').total).toBe(500);
  });
  it('leaves skipped categories out', () => {
    const e = withAdded(EMPTY_EDITS, { id: 'n1', t: at(2026, 11, 6), amount: -9000, category: 'Credit Bill' });
    expect(monthAdjust(applyEdits(txs, e), '2026-11', ['Credit Bill']).total).toBe(0);
  });
  it('lays the change over a month by category', () => {
    expect(
      adjustCategories(
        [
          ['Food & Drinks', 1000],
          ['Transport', 1000],
        ],
        new Map([
          ['Transport', -1000],
          ['Treats', 400],
        ]),
      ),
    ).toEqual([
      ['Food & Drinks', 1000],
      ['Treats', 400],
    ]);
  });
});

describe('editing helpers', () => {
  it('stores only what differs from the synced transaction', () => {
    expect(diffPatch(cafe, { merchant: 'Corner Cafe', amount: -340, note: 'Coffee', category: 'Food & Drinks', t: cafe.t + 30_000 })).toEqual({ note: 'Coffee' });
    expect(diffPatch(cafe, { amount: -345, t: cafe.t + 3_600_000, merchant: ' Corner Cafe ' })).toEqual({ amount: -345, t: cafe.t + 3_600_000 });
  });
  it('keeps hiding and changes independent', () => {
    let e = withChange(EMPTY_EDITS, keys[0], cafe, { note: 'x' });
    e = withHidden(e, keys[0], cafe, true);
    expect(e.synced[keys[0]]).toMatchObject({ note: 'x', hidden: true });
    e = withChange(e, keys[0], cafe, null); // undo the changes, still hidden
    expect(e.synced[keys[0]]).toMatchObject({ hidden: true });
    expect(e.synced[keys[0]].note).toBeUndefined();
    e = withHidden(e, keys[0], cafe, false); // nothing left
    expect(e.synced).toEqual({});
  });
  it('removes an added transaction', () => {
    const a = withAdded(EMPTY_EDITS, { id: 'n1', t: 1, amount: -1 });
    expect(withoutAdded(a, 'n1').added).toEqual([]);
  });
});
