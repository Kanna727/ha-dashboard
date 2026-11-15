// A fund's order history, from the hidden document the money sync writes
// (FINANCE.ordersStore, default 'dashboard-fold-orders'):
//   { version: 1, updated: ISO,
//     orders: { columns: ['date','type','scheme','isin','units','amount','note'], rows: [[...], ...] } }
// One row per BUY or SELL (a switch is a SELL of one fund and a BUY of another;
// `note` is the order's narration, only used to tell dividends apart), every
// order the money app has, not just the recent ones. `amount` is always
// positive money; `type` says which way it went.
import { tableRows } from '../financeDetail';

export interface Order {
  date: string; // YYYY-MM-DD
  t: number; // epoch ms at UTC midnight of the date
  type: 'BUY' | 'SELL';
  scheme: string;
  key: string;
  isin?: string;
  units: number;
  amount: number;
  note?: string;
  owner?: string;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// What two spellings of one scheme have in common: "ICICI Prudential Flexicap
// Fund - Direct Plan Growth" and "icici prudential flexicap fund direct growth".
export function schemeKey(scheme: string, isin?: string): string {
  if (isin) return isin.toUpperCase();
  return scheme
    .toLowerCase()
    .replace(/\b(direct|regular)\s+plan\b/g, '$1')
    .replace(/[^a-z0-9]+/g, '');
}

export function parseOrders(doc: unknown, owner?: string): Order[] {
  const d = doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  return tableRows(d.orders)
    .map((r): Order | undefined => {
      const date = typeof r.date === 'string' ? r.date.slice(0, 10) : undefined;
      const t = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
      const scheme = str(r.scheme);
      const units = num(r.units);
      const amount = num(r.amount);
      const type = String(r.type ?? '').toUpperCase();
      if (!date || !Number.isFinite(t) || !scheme || units === undefined || amount === undefined) return undefined;
      if (type !== 'BUY' && type !== 'SELL') return undefined;
      const isin = str(r.isin);
      // Two people holding the same fund are two funds: FIFO runs on each one's own orders.
      const key = schemeKey(scheme, isin);
      return { date, t, type, scheme, key: owner ? `${owner}:${key}` : key, isin, units: Math.abs(units), amount: Math.abs(amount), note: str(r.note), owner };
    })
    .filter((o): o is Order => !!o && o.units > 0)
    .sort((a, b) => a.t - b.t || (a.type === b.type ? 0 : a.type === 'BUY' ? -1 : 1));
}
