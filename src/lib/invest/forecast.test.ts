import { describe, expect, it } from 'vitest';
import { buildForecast, cardBills, detectSips, occurrences, stepOf, ymdLocal } from './forecast';
import { schemeKey, type Order } from './orders';

const buy = (date: string, scheme: string, amount: number): Order => ({ date, t: Date.parse(`${date}T00:00:00Z`), type: 'BUY', scheme, key: schemeKey(scheme), units: amount / 100, amount });
const now = new Date(2026, 10, 14); // 14 Nov 2026

describe('recurrence', () => {
  it('reads the money app’s frequency names', () => {
    expect(stepOf('FREQUENCY_EVERY_MONTH')).toEqual({ months: 1 });
    expect(stepOf('weekly')).toEqual({ days: 7 });
    expect(stepOf('EVERY_QUARTER')).toEqual({ months: 3 });
    expect(stepOf('yearly')).toEqual({ months: 12 });
    expect(stepOf(undefined)).toEqual({ months: 1 });
    expect(stepOf('whenever')).toBeUndefined();
  });

  it('lists monthly dates inside the window and keeps the day of the month', () => {
    expect(occurrences('2026-11-20', 'monthly', now, new Date(2027, 1, 10))).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
    // 31st lands on the last day of shorter months, then goes back to the 31st.
    expect(occurrences('2026-12-31', 'monthly', now, new Date(2027, 3, 5))).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('skips dates before the window and handles weekly and unknown frequencies', () => {
    expect(occurrences('2026-10-01', 'weekly', now, new Date(2026, 10, 30))).toEqual(['2026-11-19', '2026-11-26']);
    expect(occurrences('2026-11-20', 'whenever', now, new Date(2026, 11, 31))).toEqual(['2026-11-20']);
    expect(occurrences('nonsense', 'monthly', now, new Date(2026, 11, 31))).toEqual([]);
  });
});

describe('finding SIPs in the order history', () => {
  const sip = (scheme: string, amount: number, dates: string[]) => dates.map((d) => buy(d, scheme, amount));

  it('finds a fund bought each month for the same amount, and when it goes next', () => {
    const orders = sip('Alpha Fund', 5000, ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05']);
    expect(detectSips(orders, now)).toEqual([{ scheme: 'Alpha Fund', amount: 5000, day: 5, last: '2026-11-05', next: '2026-12-05' }]);
  });

  it('ignores lump sums, uneven amounts, and ones that stopped', () => {
    expect(detectSips([buy('2026-01-01', 'A', 50000), buy('2026-11-01', 'A', 20000)], now)).toEqual([]);
    expect(detectSips([...sip('B', 5000, ['2026-07-05', '2026-08-05']), buy('2026-09-05', 'B', 9000), buy('2026-10-05', 'B', 2000)], now)).toEqual([]);
    expect(detectSips(sip('C', 1000, ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']), now)).toEqual([]);
  });
});

describe('card bills', () => {
  it('counts the unpaid bill and the cycle still running', () => {
    const b = cardBills(
      [{ name: 'Alpha Card', cycleSpent: 12000, statementDate: '2026-11-28', lastBill: { total: 30000, due: '2026-11-20', statementDate: '2026-11-01', paid: false, remaining: 25000 } }],
      now,
    );
    expect(b).toEqual([
      { date: '2026-11-20', name: 'Alpha Card bill', amount: -25000, kind: 'card' },
      { date: '2026-12-17', name: 'Alpha Card bill (this cycle so far)', amount: -12000, kind: 'card' },
    ]);
  });

  it('leaves out a paid bill and a cycle with nothing spent', () => {
    expect(cardBills([{ name: 'B', cycleSpent: 0, statementDate: '2026-11-28', lastBill: { total: 100, due: '2026-11-20', paid: true } }], now)).toEqual([]);
  });
});

describe('the forecast', () => {
  const base = { now, days: 30, balance: 100000, recurring: [], upcoming: [], cards: [], orders: [] as Order[] };

  it('counts payments down from today’s balance and finds the lowest day', () => {
    const f = buildForecast({
      ...base,
      recurring: [{ name: 'Rent', amount: 40000, frequency: 'monthly', nextDue: '2026-12-01' }],
      cards: [{ name: 'Card', lastBill: { total: 30000, due: '2026-11-20', paid: false, remaining: 30000 } }],
      income: [{ name: 'Salary', amount: 90000, day: 1 }],
    });
    expect(f.days[0]).toEqual({ date: '2026-11-14', balance: 100000 });
    expect(f.days.find((d) => d.date === '2026-11-20')!.balance).toBe(70000);
    // Salary and rent both land on 1 December.
    expect(f.days.find((d) => d.date === '2026-12-01')!.balance).toBe(120000);
    expect(f.lowest).toEqual({ date: '2026-11-20', balance: 70000 });
    expect(f.out).toBe(70000);
    expect(f.in).toBe(90000);
    expect(f.end).toBe(f.days[f.days.length - 1].balance);
    expect(f.days).toHaveLength(31);
  });

  it('does not count a declared SIP twice when one is found in the orders', () => {
    const orders = ['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'].map((d) => buy(d, 'Alpha Fund', 5000));
    const f = buildForecast({ ...base, orders, recurring: [{ name: 'Mutual fund SIP', amount: 5000, frequency: 'monthly', nextDue: '2026-12-05' }], upcoming: [{ date: '2026-12-05', name: 'Mutual fund SIP', amount: 5000 }] });
    expect(f.events.filter((e) => /SIP|fund/i.test(e.name))).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ kind: 'sip', amount: -5000, date: '2026-12-05' });
  });

  it('adds a one-off upcoming payment that is not already a recurring one', () => {
    const f = buildForecast({ ...base, recurring: [{ name: 'Rent', amount: 40000, frequency: 'monthly', nextDue: '2026-12-01' }], upcoming: [{ date: '2026-12-01', name: 'Rent', amount: 40000 }, { date: '2026-11-25', name: 'Insurance', amount: 8000 }] });
    expect(f.events.map((e) => `${e.date} ${e.name}`)).toEqual(['2026-11-25 Insurance', '2026-12-01 Rent']);
  });

  it('says what it rests on and does not invent everyday spending', () => {
    const f = buildForecast(base);
    expect(f.events).toEqual([]);
    expect(f.lowest.balance).toBe(100000);
    expect(f.assumptions.join(' ')).toMatch(/Everyday spending/);
    expect(f.assumptions.join(' ')).toMatch(/nothing comes in/);
  });

  it('formats dates the way the money app does', () => {
    expect(ymdLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
