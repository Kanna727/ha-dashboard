// Energy: a device that used clearly more (or much less) than it normally does
// on that kind of day. The baseline is the median of the earlier days of the same
// kind (weekday or weekend, when there are enough, else all of them) and the
// spread of those days; "clearly" means above median + 3.5 spreads, and at least
// 30 % and 0.15 kWh more. Much less matters for something that should always run
// (a fridge): under 40 % of a median of at least half a kWh.
import { dayType, median, spread } from './stats';
import type { DayKwh, Insight } from './types';

const BASELINE_DAYS = 28;
const MIN_BASELINE = 10;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weekday = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long' });
const kwh = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)} kWh`;

export function energyInsights(dev: { entity: string; name: string; days: DayKwh[] }, now: number): Insight[] {
  const days = [...dev.days].sort((a, b) => a.start - b.start);
  if (days.length < MIN_BASELINE + 1) return [];
  const out: Insight[] = [];
  // The newest day that is odd is the one worth saying; look at the last two.
  for (const d of days.slice(-2).reverse()) {
    const before = days.filter((x) => x.start < d.start).slice(-BASELINE_DAYS);
    const same = before.filter((x) => dayType(x.start + 12 * 3_600_000) === dayType(d.start + 12 * 3_600_000));
    const base = same.length >= 5 ? same : before;
    if (base.length < MIN_BASELINE) continue;
    const m = median(base.map((x) => x.kwh));
    const s = spread(base.map((x) => x.kwh));
    const kind = dayType(d.start + 12 * 3_600_000);
    const when = now - d.start < 2 * 86_400_000 ? 'yesterday' : `on ${weekday(d.start)}`;
    if (d.kwh > m + Math.max(3.5 * s, 0.3 * m, 0.15)) {
      out.push({
        id: `energy-high:${dev.entity}:${ymd(d.start)}`,
        kind: 'energy-high',
        severity: d.kwh > 3 * m ? 'alert' : 'notice',
        entity: dev.entity,
        name: dev.name,
        title: `${dev.name} used ${kwh(d.kwh)} ${when}`,
        detail: `On ${kind === 'weekday' ? 'weekdays' : 'weekends'} it usually uses about ${kwh(m)}: ${Math.round(((d.kwh - m) / Math.max(m, 0.01)) * 100)} % more.`,
        at: d.start,
      });
      break;
    }
    if (m >= 0.5 && d.kwh < 0.4 * m) {
      out.push({
        id: `energy-low:${dev.entity}:${ymd(d.start)}`,
        kind: 'energy-low',
        severity: 'notice',
        entity: dev.entity,
        name: dev.name,
        title: `${dev.name} used only ${kwh(d.kwh)} ${when}`,
        detail: `It usually uses about ${kwh(m)}. Is it still switched on?`,
        at: d.start,
      });
      break;
    }
  }
  return out;
}
