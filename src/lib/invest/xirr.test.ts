import { describe, expect, it } from 'vitest';
import { xirr } from './xirr';

const D = (s: string) => Date.parse(`${s}T00:00:00Z`);

describe('xirr', () => {
  it('matches the spreadsheet function on its documented example', () => {
    // Excel's XIRR help: -10000 on 2008-01-01 ... answer 0.373362535
    const r = xirr([
      { t: D('2008-01-01'), amount: -10000 },
      { t: D('2008-03-01'), amount: 2750 },
      { t: D('2008-10-30'), amount: 4250 },
      { t: D('2009-02-15'), amount: 3250 },
      { t: D('2009-04-01'), amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });

  it('is the yearly growth for one deposit and one withdrawal', () => {
    // 2023 has 365 days, so one year exactly.
    expect(xirr([{ t: D('2023-01-01'), amount: -1000 }, { t: D('2024-01-01'), amount: 1100 }])).toBeCloseTo(0.1, 6);
  });

  it('is negative for a loss and handles losing nearly everything', () => {
    expect(xirr([{ t: D('2023-01-01'), amount: -1000 }, { t: D('2024-01-01'), amount: 800 }])).toBeCloseTo(-0.2, 6);
    expect(xirr([{ t: D('2023-01-01'), amount: -1000 }, { t: D('2024-01-01'), amount: 5 }])).toBeCloseTo(-0.995, 3);
  });

  it('copes with a very high rate over a short time', () => {
    const r = xirr([{ t: D('2024-01-01'), amount: -1000 }, { t: D('2024-02-01'), amount: 1100 }])!;
    expect(r).toBeGreaterThan(2);
    expect(r).toBeLessThan(5);
  });

  it('works for a monthly SIP with its value at the end', () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ t: D(`2024-${String(i + 1).padStart(2, '0')}-05`), amount: -1000 }));
    flows.push({ t: D('2025-01-05'), amount: 12 * 1000 * 1.06 });
    const r = xirr(flows)!;
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.16);
  });

  it('has no answer without money both going in and coming out, or all on one day', () => {
    expect(xirr([{ t: D('2024-01-01'), amount: -1000 }])).toBeUndefined();
    expect(xirr([{ t: D('2024-01-01'), amount: -1000 }, { t: D('2024-06-01'), amount: -500 }])).toBeUndefined();
    expect(xirr([{ t: D('2024-01-01'), amount: -1000 }, { t: D('2024-01-01'), amount: 1200 }])).toBeUndefined();
    expect(xirr([])).toBeUndefined();
  });

  it('ignores the order flows are given in and zero or broken amounts', () => {
    const a = xirr([{ t: D('2024-01-01'), amount: -1000 }, { t: D('2025-01-01'), amount: 1100 }]);
    const b = xirr([{ t: D('2025-01-01'), amount: 1100 }, { t: D('2024-06-01'), amount: 0 }, { t: D('2024-01-01'), amount: -1000 }, { t: NaN, amount: 5 }]);
    expect(b).toBe(a);
  });
});
