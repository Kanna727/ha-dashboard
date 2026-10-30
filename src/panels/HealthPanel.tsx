import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { HEALTH } from '../config/entities';
import { useHass, type HistoryPoint, type StatChange, type StatPoint } from '../ha/api';
import { num } from '../ha/format';
import { useEntities } from '../ha/store';
import { readCache, useRegistry, writeCache } from '../ha/useRegistry';
import { BarChart } from '../components/BarChart';
import { GlanceRing, GlanceTile } from '../components/GlanceTile';
import { Icon, type IconName } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { Sparkline } from '../components/Sparkline';
import { changeOver, findHealthSources, fmtHours, healthPeople, recoveryTone, sleepStages, type HealthPerson, type SourceKind, type Tone } from '../lib/health';

const CACHE_KEY = 'dashHealth';
const TREND_DAYS = 90;
const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c'];
const TONE_COLOR: Record<Tone, string> = { good: 'var(--ok)', fair: 'var(--accent-light)', poor: 'var(--danger)' };
const KINDS: SourceKind[] = ['scale', 'wearable', 'cycling'];

// Everyone's health devices (lib/health.ts): found in the registry, matched to
// HEALTH.people, cached so reloads draw at once.
function usePeople(): HealthPerson[] {
  const registry = useRegistry();
  const [people, setPeople] = useState<HealthPerson[]>(() => readCache(CACHE_KEY, []));
  useEffect(() => {
    if (!registry) return;
    const deviceOf = (id: string) => registry.entities.find((e) => e.entityId === id)?.deviceId;
    const next = healthPeople(findHealthSources(registry), HEALTH.people ?? [], deviceOf);
    setPeople((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    writeCache(CACHE_KEY, next);
  }, [registry]);
  return people;
}

interface Reader {
  v: (kind: SourceKind, key: string) => number | undefined;
  s: (kind: SourceKind, key: string) => HassEntity | undefined;
  unit: (kind: SourceKind, key: string) => string;
  id: (kind: SourceKind, key: string) => string | undefined;
}

function makeReader(p: HealthPerson, byId: Map<string, HassEntity | undefined>): Reader {
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
function useReaders(people: HealthPerson[]): Reader[] {
  const ids = useMemo(() => people.flatMap((p) => KINDS.flatMap((k) => Object.values(p[k]?.roles ?? {}))), [people]);
  const states = useEntities(ids);
  return useMemo(() => {
    const byId = new Map(ids.map((id, i) => [id, states[i]]));
    return people.map((p) => makeReader(p, byId));
  }, [ids, states, people]);
}

const useReader = (p: HealthPerson): Reader => useReaders(useMemo(() => [p], [p]))[0];

// The weight sensor to trust most: the scale, then the wearable, then the riding account.
function weightOf(r: Reader): { kind: SourceKind; value?: number; unit: string; id?: string } | undefined {
  for (const kind of KINDS) {
    const id = r.id(kind, 'weight');
    if (id && r.v(kind, 'weight') !== undefined) return { kind, value: r.v(kind, 'weight'), unit: r.unit(kind, 'weight') || 'kg', id };
  }
  return undefined;
}

// Daily means from long-term statistics, refreshed every 6 h. `max`: each
// day's highest value instead, put in `mean` (a day's strain only climbs).
function useDaily(ids: (string | undefined)[], days: number, stat: 'mean' | 'max' = 'mean'): Record<string, StatPoint[]> {
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
function useDailyChange(id: string | undefined, days: number): StatChange[] {
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

const toPoints = (pts: StatPoint[] = []): HistoryPoint[] => pts.filter((p) => p.mean !== undefined).map((p) => ({ t: p.start, v: p.mean! }));
const fmt = (v: number | undefined, digits = 0) => (v === undefined ? '–' : v.toFixed(digits));
const colorOf = (p: HealthPerson, i: number) => p.color ?? COLORS[i % COLORS.length];

function Delta({ change, unit, days }: { change?: number; unit: string; days: number }) {
  if (change === undefined || Math.abs(change) < 0.05) return change === undefined ? null : <span className="hp-delta">steady · {days} d</span>;
  return (
    <span className={`hp-delta ${change < 0 ? 'down' : 'up'}`}>
      {change > 0 ? '+' : '−'}
      {Math.abs(change).toFixed(1)} {unit} · {days} d
    </span>
  );
}

function Chip({ icon, children, color }: { icon: IconName; children: ReactNode; color?: string }) {
  return (
    <span className="chip hp-chip" style={color ? { color } : undefined}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}

// One person on the card: weight and its trend, then what the wearable and
// the riding account say today.
function PersonRow({ p, color, trend, onOpen }: { p: HealthPerson; color: string; trend?: StatPoint[]; onOpen: () => void }) {
  const r = useReader(p);
  const w = weightOf(r);
  const change = trend ? changeOver(trend, 30, Date.now()) : undefined;
  const recovery = r.v('wearable', 'recovery_score');
  const sleep = sleepStages((k) => r.v('wearable', k));
  const strain = r.v('wearable', 'day_strain');
  const riding = r.s('cycling', 'online')?.state.toLowerCase() === 'true' || r.s('cycling', 'online')?.state === 'on';
  const level = r.v('cycling', 'level');
  const streak = r.v('cycling', 'current_streak');
  const fat = r.v('scale', 'body_fat');

  return (
    <button className="hp-person" style={{ ['--pc' as string]: color }} onClick={onOpen}>
      <div className="hp-top">
        <span className="hp-avatar">{p.name.charAt(0).toUpperCase()}</span>
        <div className="hp-main">
          <div className="hp-name">{p.name}</div>
          {w ? (
            <div className="hp-weight">
              <strong>{fmt(w.value, 1)}</strong>
              <small>{w.unit}</small>
              <Delta change={change} unit={w.unit} days={30} />
            </div>
          ) : (
            <div className="muted small">No weight yet</div>
          )}
        </div>
        {trend && trend.length > 1 && (
          <div className="hp-spark">
            <Sparkline points={toPoints(trend)} hours={TREND_DAYS * 24} height={36} color={color} fit />
          </div>
        )}
      </div>
      <div className="hp-chips">
        {riding && (
          <Chip icon="bike" color="var(--accent-energy)">
            Riding · {fmt(r.v('cycling', 'power'))} W
          </Chip>
        )}
        {recovery !== undefined && (
          <Chip icon="heart" color={TONE_COLOR[recoveryTone(recovery)]}>
            Recovery {Math.round(recovery)}%
          </Chip>
        )}
        {sleep && <Chip icon="sleep">{fmtHours(sleep.asleep)}</Chip>}
        {strain !== undefined && <Chip icon="workout">Strain {strain.toFixed(1)}</Chip>}
        {fat !== undefined && <Chip icon="scale">Fat {fat.toFixed(1)}%</Chip>}
        {!riding && level !== undefined && (
          <Chip icon="bike">
            Lvl {Math.round(level)}
            {streak ? ` · ${Math.round(streak)} wk streak` : ''}
          </Chip>
        )}
      </div>
    </button>
  );
}

// The popup ("Trends", the owner's pick on 2026-10-26 over per-person sections
// and an everyone-side-by-side table): a tab per person, all charts: weight
// and body fat over 90 days, recovery and sleep per night, HRV and resting
// heart rate over 30 days, then strain, km ridden per day and FTP.
const TREND_KEYS: [SourceKind, string][] = [
  ['scale', 'body_fat'],
  ['cycling', 'ftp'],
  ['wearable', 'recovery_score'],
  ['wearable', 'hrv'],
  ['wearable', 'resting_heart_rate'],
  ['wearable', 'sleep_light_sleep_time'],
  ['wearable', 'sleep_sws_time'],
  ['wearable', 'sleep_rem_sleep_time'],
];
const NIGHTS = 30;
const shortDay = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

function TrendLine({ title, icon, pts, unit, digits = 1, color, days, lowerIsBetter }: { title: string; icon: IconName; pts: StatPoint[]; unit: string; digits?: number; color: string; days: number; lowerIsBetter?: boolean }) {
  const ok = pts.filter((p) => p.mean !== undefined);
  if (ok.length < 2) return null;
  const vals = ok.map((p) => p.mean!);
  const change = changeOver(ok, days, Date.now());
  const better = change === undefined ? undefined : lowerIsBetter ? change < 0 : change > 0;
  return (
    <section className="card hp-card">
      <header className="card-head">
        <Icon name={icon} size={18} />
        <h2>{title}</h2>
        {change !== undefined && Math.abs(change) >= 0.05 && (
          <span className="small" style={{ color: better ? 'var(--ok)' : 'var(--warn)', fontWeight: 700 }}>
            {change > 0 ? '+' : '−'}
            {Math.abs(change).toFixed(digits)} {unit} · {days} d
          </span>
        )}
      </header>
      <div className="hp-big">
        <strong>{vals[vals.length - 1].toFixed(digits)}</strong>
        <small>{unit}</small>
        <span className="muted small">
          low {Math.min(...vals).toFixed(digits)} · high {Math.max(...vals).toFixed(digits)}
        </span>
      </div>
      <Sparkline points={toPoints(ok)} hours={days * 24} height={80} color={color} fit />
    </section>
  );
}

function NightBars({ title, icon, bars, caption }: { title: string; icon: IconName; bars: { start: number; v: number; color: string }[]; caption: (v: number) => string }) {
  if (bars.length < 2) return null;
  const avg = bars.reduce((s, b) => s + b.v, 0) / bars.length;
  return (
    <section className="card hp-card">
      <header className="card-head">
        <Icon name={icon} size={18} />
        <h2>{title}</h2>
        <span className="muted small">avg {caption(avg)}</span>
      </header>
      <BarChart
        bars={bars.map((b) => ({ key: b.start, parts: [b.v], color: b.color, label: `${shortDay(b.start)}: ${caption(b.v)}` }))}
        colors={['var(--accent)']}
        height={100}
        caption={(b) => (
          <>
            <strong>{caption(b.parts[0])}</strong>
            <span className="muted small">{shortDay(b.key as number)}</span>
          </>
        )}
      />
    </section>
  );
}

function TrendsPerson({ p }: { p: HealthPerson }) {
  const r = useReader(p);
  const w = weightOf(r);
  const ids = [w?.id, ...TREND_KEYS.map(([k, key]) => r.id(k, key))];
  const h = useDaily(ids, TREND_DAYS);
  const get = (k: SourceKind, key: string) => {
    const id = r.id(k, key);
    return id ? h[id] ?? [] : [];
  };
  const recent = (pts: StatPoint[]) => pts.filter((x) => x.mean !== undefined).slice(-NIGHTS);
  const recovery = recent(get('wearable', 'recovery_score')).map((x) => ({ start: x.start, v: x.mean!, color: TONE_COLOR[recoveryTone(x.mean!)] }));
  const stages = ['sleep_light_sleep_time', 'sleep_sws_time', 'sleep_rem_sleep_time'].map((k) => new Map(get('wearable', k).map((x) => [x.start, x.mean])));
  const sleep = [...stages[0].keys()]
    .map((t) => ({ start: t, v: stages.reduce((s, m) => s + (m.get(t) ?? 0), 0), color: '#818cf8' }))
    .filter((x) => x.v > 0)
    .slice(-NIGHTS);
  const target = r.v('scale', 'target_weight');
  // Riding and strain (the owner asked for them on 2026-10-27): each day's
  // highest WHOOP strain, km ridden per day from the riding account's lifetime
  // distance (km, or m converted), and FTP over 90 days.
  const strainId = r.id('wearable', 'day_strain');
  const strainDays = useDaily([strainId], NIGHTS, 'max');
  const strain = recent(strainId ? strainDays[strainId] ?? [] : []).map((x) => ({ start: x.start, v: x.mean!, color: '#38bdf8' }));
  const distId = r.id('cycling', 'total_distance');
  const perKm = /^m$/i.test(r.unit('cycling', 'total_distance')) ? 1000 : 1;
  const rides = useDailyChange(distId, NIGHTS).map((x) => ({ start: x.start, v: Math.max(0, x.change) / perKm, color: '#34d399' }));
  const sections = [
    w?.id && (
      <TrendLine key="w" title={target !== undefined ? `Weight · target ${fmt(target, 1)}` : 'Weight'} icon="scale" pts={h[w.id] ?? []} unit={w.unit} color="var(--pc)" days={TREND_DAYS} lowerIsBetter />
    ),
    <TrendLine key="fat" title="Body fat" icon="scale" pts={get('scale', 'body_fat')} unit="%" color="#fbbf24" days={TREND_DAYS} lowerIsBetter />,
    <NightBars key="rec" title="Recovery" icon="heart" bars={recovery} caption={(v) => `${Math.round(v)}%`} />,
    <NightBars key="sleep" title="Sleep" icon="sleep" bars={sleep} caption={(v) => fmtHours(v)} />,
    <TrendLine key="hrv" title="HRV" icon="heart" pts={get('wearable', 'hrv').slice(-NIGHTS)} unit="ms" digits={0} color="var(--ok)" days={NIGHTS} />,
    <TrendLine key="rhr" title="Resting heart rate" icon="heart" pts={get('wearable', 'resting_heart_rate').slice(-NIGHTS)} unit="bpm" digits={0} color="var(--danger)" days={NIGHTS} lowerIsBetter />,
    strainId && <NightBars key="strain" title="Strain" icon="workout" bars={strain} caption={(v) => v.toFixed(1)} />,
    distId && rides.length > 0 && (
      <NightBars key="ride" title={`Riding · ${Math.round(rides.reduce((s, x) => s + x.v, 0))} km`} icon="bike" bars={rides} caption={(v) => `${v.toFixed(1)} km`} />
    ),
    r.id('cycling', 'ftp') && <TrendLine key="ftp" title="FTP" icon="bike" pts={get('cycling', 'ftp')} unit="W" digits={0} color="#a78bfa" days={TREND_DAYS} />,
  ].filter(Boolean);
  // Two columns that stack on their own (no gaps under short charts); `order`
  // keeps the charts in this order when a phone shows one column.
  const slots = sections.map((s, i) => (
    <div key={i} className="hp-slot" style={{ order: i }}>
      {s}
    </div>
  ));
  const left = slots.filter((_, i) => i % 2 === 0);
  const right = slots.filter((_, i) => i % 2 === 1);
  return (
    <div className="hp-detail-body">
      <div className="hp-col">{left}</div>
      <div className="hp-col">{right}</div>
    </div>
  );
}

function HealthDetail({ people, start }: { people: HealthPerson[]; start: number }) {
  const [at, setAt] = useState(start);
  const p = people[at] ?? people[0];
  if (!p) return null;
  return (
    <div className="hp-detail" style={{ ['--pc' as string]: colorOf(p, at) }}>
      {people.length > 1 && (
        <div className="segmented">
          {people.map((x, i) => (
            <button key={x.name + i} className={at === i ? 'active' : ''} onClick={() => setAt(i)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      <TrendsPerson key={at} p={p} />
    </div>
  );
}

// The card ("Rows", the owner's pick on 2026-10-26 over rings and a table): a
// row per person. `full` (tablet and desktop Health page): the popup's trends
// under the rows, for the person whose row was tapped last.
export function HealthPanel({ full = false }: { full?: boolean }) {
  const modal = useModal();
  const people = usePeople();
  const weights = useMemo(
    () => people.map((p) => KINDS.map((k) => p[k]?.roles.weight).find(Boolean)),
    [people],
  );
  const trends = useDaily(weights, TREND_DAYS);
  const [picked, setPicked] = useState(0);
  const open = (i: number) =>
    full ? setPicked(i) : modal.open({ title: 'Health', icon: 'heart', accent: 'var(--danger)', wide: true, body: <HealthDetail people={people} start={i} /> });
  const shown = people[picked] ?? people[0];

  return (
    <section className={`panel health-panel ${full ? 'full' : ''}`}>
      <PanelHead label="Health" summary={full && people.length > 1 ? 'Tap a person for their trends' : undefined} onMore={people.length && !full ? () => open(0) : undefined} />
      {!people.length ? (
        <p className="muted">No scales, wearables or riding accounts found in Home Assistant.</p>
      ) : (
        <ul className="hp-people">
          {people.map((p, i) => (
            <li key={p.name + i} className={full && shown === p ? 'picked' : undefined}>
              <PersonRow p={p} color={colorOf(p, i)} trend={weights[i] ? trends[weights[i]!] : undefined} onOpen={() => open(i)} />
            </li>
          ))}
        </ul>
      )}
      {full && shown && (
        <div className="hp-detail" style={{ ['--pc' as string]: colorOf(shown, people.indexOf(shown)) }}>
          <TrendsPerson key={people.indexOf(shown)} p={shown} />
        </div>
      )}
    </section>
  );
}

function PersonGlance({ p, color }: { p: HealthPerson; color: string }) {
  const r = useReader(p);
  const weight = r.v('scale', 'weight');
  const ftp = r.v('cycling', 'ftp');
  const recovery = r.v('wearable', 'recovery_score');
  return (
    <span className="glance-person" style={{ ['--pc' as string]: color }}>
      {recovery !== undefined ? (
        <GlanceRing pct={recovery} color={TONE_COLOR[recoveryTone(recovery)]} size={54}>
          {Math.round(recovery)}
        </GlanceRing>
      ) : (
        <span className="glance-avatar">{p.name.charAt(0).toUpperCase()}</span>
      )}
      <span className="glance-person-text">
        <b>{weight !== undefined ? fmt(weight, 1) : '–'}</b>
        <small>
          {p.name}
          {ftp !== undefined ? ` · FTP ${Math.round(ftp)} W` : ''}
        </small>
      </span>
    </span>
  );
}

// Home page tile (GlancePanel): per person a recovery ring (green, amber or
// red, as WHOOP colours it) from the wearable, the weight from the scale only,
// and the FTP from the riding account.
export function HealthTile() {
  const people = usePeople();
  if (!people.length) return null;
  return (
    <GlanceTile
      icon="heart"
      label="Health · recovery, weight and FTP"
      page="health"
      span={2}
      color="var(--danger)"
      foot={
        <span className="glance-people">
          {people.map((p, i) => (
            <PersonGlance key={p.name + i} p={p} color={colorOf(p, i)} />
          ))}
        </span>
      }
    />
  );
}
