import type { StatPoint } from '../ha/api';

export interface DayEnergy {
  start: number; // epoch ms, local midnight (as HA's daily statistics bucket it)
  kwh: number;
  partial: boolean; // today, still accumulating
}

const DAY = 86_400_000;

// Daily kWh from daily *mean power* statistics (W): mean × hours ÷ 1000. Days
// covered by the newer total sensor use it; earlier days fall back to the
// legacy one, the same splice as fetchHomePowerHistory. Today counts only the
// hours elapsed so far.
export function dailyKwh(total: StatPoint[], legacy: StatPoint[], now: number): DayEnergy[] {
  const byDay = new Map<number, number>();
  for (const p of legacy) if (p.mean !== undefined && Number.isFinite(p.mean)) byDay.set(p.start, p.mean);
  for (const p of total) if (p.mean !== undefined && Number.isFinite(p.mean)) byDay.set(p.start, p.mean);
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, meanW]) => {
      const partial = now < start + DAY;
      const hours = partial ? Math.max(0, (now - start) / 3_600_000) : 24;
      return { start, kwh: (meanW * hours) / 1000, partial };
    });
}

// Average over complete days only (today would drag it down).
export function averageKwh(days: DayEnergy[]): number | undefined {
  const full = days.filter((d) => !d.partial);
  return full.length ? full.reduce((s, d) => s + d.kwh, 0) / full.length : undefined;
}
