// The mock history the house insights read (lib/insights/): ten days of the
// example home's doors, geysers, fans and lights, and a month of daily energy per
// plug. Seeded, so it is the same every load, and dated from now. It plants one of
// each kind of finding: the main door opened in the small hours, a geyser that has
// been on for hours, the fridge using almost twice its usual energy yesterday,
// and regular habits (geysers in the morning, the sofa fan and the lights in the
// evening) for the "suggest an automation" part.
import type { StatPoint } from '../src/ha/api';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const hashOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7);

type Row = { t: number; s: string };

const at = (day: Date, h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
const isWeekend = (d: Date) => [0, 6].includes(d.getDay());

export function mockStateHistory(ids: string[], hours: number): Record<string, Row[]> {
  const now = Date.now();
  const start = now - hours * HOUR;
  const out: Record<string, Row[]> = {};
  for (const id of ids) {
    const rand = seeded(hashOf(id));
    const rows: Row[] = [{ t: start, s: 'off' }];
    const run = (a: number, b: number | null) => {
      if (a < start || a > now) return;
      rows.push({ t: a, s: 'on' });
      if (b !== null && b < now) rows.push({ t: b, s: 'off' });
    };
    const days = Array.from({ length: Math.ceil(hours / 24) + 1 }, (_, i) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - (Math.ceil(hours / 24) - i)));
    const domain = id.split('.')[0];
    if (domain === 'binary_sensor' && /door/.test(id) && !/oven|washing|fridge/.test(id)) {
      for (const d of days) {
        const n = 5 + Math.floor(rand() * 5);
        for (let k = 0; k < n; k++) {
          const a = at(d, 7, 0) + Math.floor(rand() * 15 * 60) * MIN;
          run(a, a + (20 + Math.floor(rand() * 70)) * 1000);
        }
      }
      if (id.includes('main_door')) {
        // Small hours: opened at about 03:07 on the last night that has passed.
        const today = new Date();
        const t = at(today, 3, 7);
        const a = t < now ? t : t - DAY;
        run(a, a + 45_000);
      }
    } else if (/geyser/.test(id)) {
      for (const d of days) {
        const weekend = isWeekend(d);
        const a = at(d, weekend ? 8 : 6, weekend ? Math.floor(rand() * 12) : 2 + Math.floor(rand() * 16));
        run(a, a + (weekend ? 40 : 25 + Math.floor(rand() * 10)) * MIN);
      }
      // Switched on and forgotten.
      if (id.includes('common_bathroom')) rows.push({ t: now - 2.5 * HOUR, s: 'on' });
    } else if (domain === 'fan') {
      for (const d of days) {
        if (isWeekend(d)) continue;
        const a = at(d, 19, 20 + Math.floor(rand() * 20));
        run(a, at(d, 23, 20 + Math.floor(rand() * 25)));
      }
    } else if (domain === 'light') {
      for (const d of days) {
        const a = at(d, 18, 20 + Math.floor(rand() * 20));
        run(a, at(d, 22, 50 + Math.floor(rand() * 20)));
      }
    }
    out[id] = rows.sort((a, b) => a.t - b.t);
  }
  return out;
}

// Daily mean watts of a plug for `days` days (today partial), the way HA's statistics give them.
export function plugDailyStats(id: string, days: number): StatPoint[] | undefined {
  if (!/_power$/.test(id) || /^sensor\.(home|total)_/.test(id)) return undefined;
  const rand = seeded(hashOf(id) + 11);
  const base = id.includes('fridge') ? 82 : id.includes('geyser') ? 140 : id.includes('pc') ? 110 : 40 + (hashOf(id) % 60);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days + 1 }, (_, i) => {
    const start = today.getTime() - (days - i) * DAY;
    const age = days - i; // 0 = today, 1 = yesterday
    let mean = base * (0.94 + rand() * 0.12);
    if (id.includes('fridge') && age === 1) mean *= 1.8; // the planted anomaly
    return { start, mean, max: mean };
  });
}
