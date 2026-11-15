// The mock order history (the hidden 'dashboard-fold-orders' document the sync
// would write, lib/invest/orders.ts): fictional SIPs, a lump sum, a part sale, two
// funds sold in full (one short term, one long term) and a fund whose orders
// start after it was already held, so every part of the Returns and Gains cards
// has something to show. Dated from today, so it always looks current.
import { MOCK_HOLDINGS } from './finance';

type Row = [string, string, string, string, number, number, string | null];

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const monthsAgo = (m: number, day: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - m, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const isin = (name: string) => `INF${name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}01`;
const holding = (name: string) => MOCK_HOLDINGS.find((h) => h.scheme.startsWith(name))!;

// The price of a unit `months` ago if it grew `yearly` a year to `navNow`.
const navThen = (navNow: number, yearly: number, months: number) => navNow / Math.pow(1 + yearly, months / 12);

export function mockOrders(): { version: number; updated: string; orders: { columns: string[]; rows: Row[] } } {
  const rows: Row[] = [];
  const buy = (scheme: string, date: string, amount: number, nav: number, note = 'Purchase') => rows.push([date, 'BUY', scheme, isin(scheme), +(amount / nav).toFixed(3), amount, note]);
  const sell = (scheme: string, date: string, units: number, nav: number, note = 'Redemption') => rows.push([date, 'SELL', scheme, isin(scheme), +units.toFixed(3), Math.round(units * nav * 100) / 100, note]);

  // Make the units add up to what the snapshot says is held (the last buy takes the difference).
  const fitUnits = (scheme: string, held: number) => {
    const mine = rows.filter((r) => r[2] === scheme);
    const net = mine.reduce((s, r) => s + (r[1] === 'BUY' ? r[4] : -r[4]), 0);
    const lastBuy = [...mine].reverse().find((r) => r[1] === 'BUY')!;
    lastBuy[4] = +(lastBuy[4] + (held - net)).toFixed(3);
  };

  const plan = (name: string, months: number, amount: number, yearly: number, day = 5) => {
    const h = holding(name);
    const navNow = h.value / (h.units ?? 1);
    for (let m = months - 1; m >= 0; m--) buy(h.scheme, monthsAgo(m, day), amount, navThen(navNow, yearly, m));
    return { h, navNow };
  };

  // A SIP over 26 months adding up to what is held plus what the part sale 4 months ago took out.
  {
    const { h, navNow } = plan('Northwind', 26, 2500, 0.14);
    sell(h.scheme, monthsAgo(4, 18), 60, navThen(navNow, 0.14, 4));
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const { h } = plan('Bluebird', 18, 2700, 0.1, 7);
    fitUnits(h.scheme, h.units ?? 0);
  }
  // Lump sums.
  {
    const h = holding('Harbor');
    const navNow = h.value / (h.units ?? 1);
    buy(h.scheme, monthsAgo(19, 12), 25000, navThen(navNow, 0.06, 19));
    buy(h.scheme, monthsAgo(9, 3), 11000, navThen(navNow, 0.06, 9));
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const h = holding('Meadow');
    const navNow = h.value / (h.units ?? 1);
    buy(h.scheme, monthsAgo(15, 20), 18000, navThen(navNow, 0.08, 15));
    buy(h.scheme, monthsAgo(6, 20), 10000, navThen(navNow, 0.08, 6));
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const { h } = plan('Summit', 8, 2750, 0.2, 9);
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const h = holding('Riverside');
    const navNow = h.value / (h.units ?? 1);
    buy(h.scheme, monthsAgo(5, 2), 18000, navThen(navNow, 0.04, 5));
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const { h } = plan('Lantern', 12, 1000, -0.02, 15);
    fitUnits(h.scheme, h.units ?? 0);
  }
  // Held before the history starts: the orders show a sale of units never bought.
  {
    const h = holding('Orchard');
    const navNow = h.value / (h.units ?? 1);
    sell(h.scheme, monthsAgo(11, 4), 40, navThen(navNow, 0.04, 11));
    buy(h.scheme, monthsAgo(3, 4), 9900, navThen(navNow, 0.04, 3));
    fitUnits(h.scheme, h.units ?? 0);
  }
  {
    const h = holding('Cedar');
    const navNow = h.value / (h.units ?? 1);
    buy(h.scheme, monthsAgo(2, 22), 6000, navThen(navNow, 0.22, 2));
    fitUnits(h.scheme, h.units ?? 0);
  }
  // Sold in full: held for 31 months and sold 14 months ago (long term), and held 10 months and sold 3 months ago (short term).
  {
    const name = 'Quartz Value Fund - Direct Plan Growth';
    for (const m of [31, 30, 29, 28]) buy(name, monthsAgo(m, 8), 10000, navThen(52, 0.12, m - 14));
    sell(name, monthsAgo(14, 16), rows.filter((r) => r[2] === name).reduce((s, r) => s + r[4], 0), 52);
  }
  {
    const name = 'Ridge Technology Fund - Direct Plan Growth';
    buy(name, monthsAgo(10, 11), 15000, 31);
    sell(name, monthsAgo(3, 25), rows.filter((r) => r[2] === name).reduce((s, r) => s + r[4], 0), 36.4);
  }

  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    version: 1,
    updated: now.toISOString(),
    orders: { columns: ['date', 'type', 'scheme', 'isin', 'units', 'amount', 'note'], rows },
  };
}
