import type { ReactNode } from 'react';
import { fmtInr, fmtShort } from '../lib/finance';
import { Amt } from './Amt';

// Small pieces shared by the Money page's panels.

// Under a lakh in full (₹84,250), above that short (₹4.13 L).
export const fmtAuto = (n: number) => (Math.abs(n) < 1e5 ? fmtInr(n) : fmtShort(n));

const ymdDate = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
// "5 Nov", or "5 Nov 2029" when it isn't this year.
export function fmtDate(date: string, now = new Date(), weekday = false): string {
  const d = ymdDate(date);
  return d.toLocaleDateString('en-IN', {
    ...(weekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
export const fmtMonth = (ym: string, long = false) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
};
export const fmtPct = (n: number, dp = 1) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(dp)}%`;
// "+₹2,061" / "−₹166".
export const fmtSigned = (n: number) => `${n < 0 ? '−' : '+'}${fmtAuto(Math.abs(n))}`;

export function Head({ label, summary, warn, children }: { label: string; summary?: ReactNode; warn?: boolean; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <h2 className="label">{label}</h2>
      {summary !== undefined && <span className={`panel-summary ${warn ? 'warn' : ''}`}>{summary}</span>}
      {children}
    </header>
  );
}

// "Show all 40" / "Show fewer" under a list that's cut short.
export function MoreButton({ open, total, onClick }: { open: boolean; total: number; onClick: () => void }) {
  return (
    <button className="money-more" onClick={onClick}>
      {open ? 'Show fewer' : `Show all ${total}`}
    </button>
  );
}

// One horizontal bar split into parts, with an optional key under it.
export function StackBar({ parts, keyed = true, money = true }: { parts: [string, number, string][]; keyed?: boolean; money?: boolean }) {
  const shown = parts.filter(([, v]) => v > 0);
  const sum = shown.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="stackbar">
      <div className="stackbar-bar" aria-hidden>
        {shown.map(([k, v, c]) => (
          <i key={k} style={{ flexGrow: v / sum, background: c }} />
        ))}
      </div>
      {keyed && (
        <ul className="stackbar-key">
          {shown.map(([k, v, c]) => (
            <li key={k}>
              <i style={{ background: c }} />
              {k}{' '}
              <b>{money ? <Amt>{fmtAuto(v)}</Amt> : `${Math.round((v / sum) * 100)}%`}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A rating word's tone: Excellent/Good green, Fair orange, Poor red.
export function ratingTone(r: string | undefined): 'ok' | 'warn' | 'bad' | '' {
  if (!r) return '';
  if (/excellent|very good|good/i.test(r)) return 'ok';
  if (/fair|average/i.test(r)) return 'warn';
  if (/poor|bad/i.test(r)) return 'bad';
  return '';
}
