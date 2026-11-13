import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useHass, type HistoryPoint, type StatChange, type StatPoint } from '../ha/api';
import { num } from '../ha/format';
import { useEntities } from '../ha/store';
import { Icon, type IconName } from '../components/Icon';
import type { HealthPerson, SourceKind, Tone } from '../lib/health';

// What the Health card and its profile share: the readers of a person's devices, the
// statistics hooks, and a few small pieces.
export const CACHE_KEY = 'dashHealth';
export const TREND_DAYS = 90;
export const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c'];
export const TONE_COLOR: Record<Tone, string> = { good: 'var(--ok)', fair: 'var(--accent-light)', poor: 'var(--danger)' };
export const KINDS: SourceKind[] = ['scale', 'wearable', 'cycling'];

export interface Reader {
  v: (kind: SourceKind, key: string) => number | undefined;
  s: (kind: SourceKind, key: string) => HassEntity | undefined;
  unit: (kind: SourceKind, key: string) => string;
  id: (kind: SourceKind, key: string) => string | undefined;
}

export function makeReader(p: HealthPerson, byId: Map<string, HassEntity | undefined>): Reader {
  const id = (k: SourceKind, key: string) => p[k]?.roles[key];
  const s = (k: SourceKind, key: string) => {
    const x = id(k, key);
    return x ? byId.get(x) : undefined;
  };
  return {
    id,
    s,
    v: (k, key) => num(s(k, key)),
    unit: (k, key) => String(s(k, key)?.attributes.unit_of_measurement ?? ''),
  };
}

// Live readings of each person's devices.
export function useReaders(people: HealthPerson[]): Reader[] {
  const ids = useMemo(() => people.flatMap((p) => KINDS.flatMap((k) => Object.values(p[k]?.roles ?? {}))), [people]);
  const states = useEntities(ids);
  return useMemo(() => {
    const byId = new Map(ids.map((id, i) => [id, states[i]]));
    return people.map((p) => makeReader(p, byId));
  }, [ids, states, people]);
}

export const useReader = (p: HealthPerson): Reader => useReaders(useMemo(() => [p], [p]))[0];

// The weight sensor to trust most: the scale, then the wearable, then the riding account.
export function weightOf(r: Reader): { kind: SourceKind; value?: number; unit: string; id?: string } | undefined {
  for (const kind of KINDS) {
    const id = r.id(kind, 'weight');
    if (id && r.v(kind, 'weight') !== undefined) return { kind, value: r.v(kind, 'weight'), unit: r.unit(kind, 'weight') || 'kg', id };
  }
  return undefined;
}

// Daily means from long-term statistics, refreshed every 6 h. `max`: each
// day's highest value instead, put in `mean` (a day's strain only climbs).
export function useDaily(ids: (string | undefined)[], days: number, stat: 'mean' | 'max' = 'mean'): Record<string, StatPoint[]> {
  const hass = useHass();
  const [stats, setStats] = useState<Record<string, StatPoint[]>>({});
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      hass
        .fetchStatistics(key.split(','), days, 'day', [stat])
        .then((s) => alive && setStats(stat === 'max' ? Object.fromEntries(Object.entries(s).map(([id, pts]) => [id, pts.map((p) => ({ start: p.start, mean: p.max }))])) : s))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 6 * 3_600_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, key, days, stat]);
  return stats;
}

// Daily change of a total (km ridden from a lifetime distance), refreshed every 6 h.
export function useDailyChange(id: string | undefined, days: number): StatChange[] {
  const hass = useHass();
  const [rows, setRows] = useState<StatChange[]>([]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      hass
        .fetchStatChanges([id], days, 'day')
        .then((s) => alive && setRows(s[id] ?? []))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 6 * 3_600_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, id, days]);
  return rows;
}

export const toPoints = (pts: StatPoint[] = []): HistoryPoint[] => pts.filter((p) => p.mean !== undefined).map((p) => ({ t: p.start, v: p.mean! }));
export const fmt = (v: number | undefined, digits = 0) => (v === undefined ? '–' : v.toFixed(digits));
export const colorOf = (p: HealthPerson, i: number) => p.color ?? COLORS[i % COLORS.length];

export function Delta({ change, unit, days }: { change?: number; unit: string; days: number }) {
  if (change === undefined || Math.abs(change) < 0.05) return change === undefined ? null : <span className="hp-delta">steady · {days} d</span>;
  return (
    <span className={`hp-delta ${change < 0 ? 'down' : 'up'}`}>
      {change > 0 ? '+' : '−'}
      {Math.abs(change).toFixed(1)} {unit} · {days} d
    </span>
  );
}

export function Chip({ icon, children, color }: { icon: IconName; children: ReactNode; color?: string }) {
  return (
    <span className="chip hp-chip" style={color ? { color } : undefined}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}
