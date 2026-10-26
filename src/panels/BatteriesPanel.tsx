import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { BATTERIES, ROOMS } from '../config/entities';
import { useHass, type RegistrySnapshot } from '../ha/api';
import { store } from '../ha/store';
import { useRegistry } from '../ha/useRegistry';
import { GlanceTile } from '../components/GlanceTile';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { batteryOutlook, batteryRows, clusterByPosition, fmtOutlook, labelRows, type BatteryRow, type Outlook } from '../lib/batteries';

interface Memo {
  registry?: RegistrySnapshot;
  count: number;
  watched: string[];
  refs: (HassEntity | undefined)[];
  key: string;
  rows: BatteryRow[];
}

// Every battery in HA (lib/batteries.ts), worst first. Power sensors tick every
// few seconds, so a store update only rescans everything when an entity came or
// went or a battery-related one changed; it re-renders only when a row changed.
function useBatteries(): BatteryRow[] {
  const registry = useRegistry();
  const memo = useRef<Memo>();
  return useSyncExternalStore(store.subscribe, () => {
    const all = store.getAll();
    const m = memo.current;
    const ids = Object.keys(all);
    if (m && m.registry === registry && m.count === ids.length && m.watched.every((id, i) => all[id] === m.refs[i])) return m.rows;
    const rows = batteryRows(all, registry, BATTERIES.low, BATTERIES.hide);
    const watched = ids.filter((id) => /batter|charg/.test(id) || all[id].attributes.device_class === 'battery');
    const key = JSON.stringify(rows);
    memo.current = { registry, count: ids.length, watched, refs: watched.map((id) => all[id]), key, rows: m && m.key === key ? m.rows : rows };
    return memo.current.rows;
  });
}

export const areaName = (id: string | undefined) =>
  id ? ROOMS.find((r) => r.id === id)?.name ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : undefined;

function BatteryLine({ row, outlook }: { row: BatteryRow; outlook?: Outlook }) {
  const area = areaName(row.area);
  const icon = row.charging ? 'charging' : row.status === 'ok' ? 'battery' : 'batteryLow';
  const value = row.status === 'offline' ? 'Offline' : row.level !== undefined ? `${Math.round(row.level)}%` : row.status === 'low' ? 'Low' : 'OK';
  const sub = [area, row.charging ? 'Charging' : undefined, outlook ? fmtOutlook(outlook) : undefined].filter(Boolean).join(' · ');
  return (
    <li className={`bat-row ${row.status}`}>
      <Icon name={icon} size={20} />
      <span className="bat-name">
        <span>{row.name}</span>
        {sub && <small className="muted">{sub}</small>}
      </span>
      <span className="bat-bar" aria-hidden>
        <i style={{ width: `${row.level ?? (row.status === 'low' ? 10 : row.status === 'ok' ? 100 : 0)}%` }} />
      </span>
      <span className="bat-val">{value}</span>
    </li>
  );
}

const HISTORY_DAYS = 125; // batteryOutlook looks back 120 days

// Outlooks (card and popup) from the long-term daily means of every battery
// that doesn't report charging (phones and tablets do), refetched every 6 h.
function useOutlooks(rows: BatteryRow[]): Record<string, Outlook | undefined> {
  const hass = useHass();
  const [out, setOut] = useState<Record<string, Outlook | undefined>>({});
  const ids = rows.filter((r) => !r.rechargeable && r.level !== undefined).map((r) => r.entity);
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split(',');
    const load = () =>
      hass
        .fetchStatistics(list, HISTORY_DAYS, 'day')
        .then((s) => {
          if (!alive) return;
          const now = Date.now();
          const levels = new Map(rows.map((r) => [r.entity, r.level]));
          setOut(Object.fromEntries(list.map((id) => [id, batteryOutlook(s[id] ?? [], levels.get(id) ?? 0, now)])));
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 6 * 3_600_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // Levels drift by a percent at a time; refetching for that isn't worth it.
  }, [hass, key]);
  return out;
}

function BatteriesDetail() {
  const rows = useBatteries();
  const outlooks = useOutlooks(rows);
  return <TimelineDetail rows={rows} outlooks={outlooks} />;
}

type Outlooks = Record<string, Outlook | undefined>;
const AXIS_DAYS = 120;
const LANES: { id: string; title: string; test: (r: BatteryRow, o?: Outlook) => boolean }[] = [
  { id: 'now', title: 'Replace now', test: (r) => r.status === 'critical' || r.status === 'low' },
  { id: 'off', title: 'Not reporting', test: (r) => r.status === 'offline' },
  { id: 'soon', title: 'Within a month', test: (_r, o) => o?.kind === 'drain' && o.days! <= 30 },
  { id: 'charge', title: 'Charged now and then', test: (r, o) => r.rechargeable || o?.kind === 'recharge' },
  { id: 'later', title: 'In 1–4 months', test: (_r, o) => o?.kind === 'drain' && o.days! <= AXIS_DAYS },
  { id: 'year', title: 'In 4–12 months', test: (_r, o) => o?.kind === 'drain' },
  { id: 'slow', title: 'More than a year', test: (_r, o) => o?.kind === 'slow' },
  { id: 'flat', title: 'No drop measured yet', test: (_r, o) => o?.kind === 'flat' },
  { id: 'short', title: 'New battery, still measuring', test: (_r, o) => o?.kind === 'short' },
  { id: 'binary', title: 'Only report low or OK', test: (r) => r.level === undefined && r.status !== 'offline' },
  { id: 'unknown', title: 'No history yet', test: () => true },
];

const ROW_H = 20;
const RANK_OF: Record<BatteryRow['status'], number> = { critical: 0, low: 1, offline: 2, ok: 3 };
// Label width at 11 px: about 6.3 px a character, capped like the CSS max-width.
const labelWidth = (text: string) => Math.min(160, Math.round(text.length * 6.3) + 4);

// The dots and their names. Batteries at nearly the same spot share a dot and
// a label ("Hall sensor +3"; hover or long-press shows them all), and labels go
// in the lowest row where they don't touch another, measured against the
// axis's real width.
function TimelineAxis({ dated, outlooks }: { dated: { r: BatteryRow; d: number }[]; outlooks: Outlooks }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const clusters = clusterByPosition(dated.map((x) => ({ ...x, at: Math.min(x.d, AXIS_DAYS) / AXIS_DAYS })));
  const labels = clusters.map((c) => {
    const sorted = [...c].sort((a, b) => a.d - b.d);
    const text = sorted.length > 1 ? `${sorted[0].r.name} +${sorted.length - 1}` : sorted[0].r.name;
    const worst = sorted.reduce((w, x) => (RANK_OF[x.r.status] < RANK_OF[w.r.status] ? x : w), sorted[0]);
    const title = sorted.map(({ r }) => `${r.name}: ${outlooks[r.entity] ? fmtOutlook(outlooks[r.entity]!) : 'now'}`).join('\n');
    return { key: sorted.map((x) => x.r.entity).join(','), at: c[0].at, text, status: worst.r.status, title, width: labelWidth(text) };
  });
  const rows = labelRows(labels, width || 600);
  const height = 34 + (Math.max(0, ...rows) + 1) * ROW_H;
  return (
    <div className="bat-axis" ref={ref} style={{ height }}>
      <span className="bat-axis-line" />
      {labels.map((l, i) => (
        <span key={l.key} className={`bat-axis-dot ${l.status}`} style={{ ['--at' as string]: `${l.at * 100}%`, ['--row' as string]: rows[i] }} title={l.title}>
          <i />
          <small>{l.text}</small>
        </span>
      ))}
    </div>
  );
}

// The popup ("Timeline", the owner's pick on 2026-10-26 over status groups and
// a card per room): every battery with a date on a line by when it runs out
// (or needs charging), then lanes from "replace now" to "more than a year" and
// the ones without a date, each saying why.
function TimelineDetail({ rows, outlooks }: { rows: BatteryRow[]; outlooks: Outlooks }) {
  const lanes = new Map<string, BatteryRow[]>();
  for (const r of rows) {
    const lane = LANES.find((l) => l.test(r, outlooks[r.entity]))!;
    lanes.set(lane.id, [...(lanes.get(lane.id) ?? []), r]);
  }
  const dated = rows
    .map((r) => ({ r, d: r.status === 'critical' || r.status === 'low' ? 0 : outlooks[r.entity]?.days }))
    .filter((x): x is { r: BatteryRow; d: number } => x.d !== undefined);
  return (
    <div className="bat-timeline">
      <section className="card">
        <header className="card-head">
          <Icon name="timer" size={18} />
          <h2>When they run out</h2>
        </header>
        <TimelineAxis dated={dated} outlooks={outlooks} />
        <div className="bat-axis-ticks">
          <span>Now</span>
          <span>1 month</span>
          <span>2 months</span>
          <span>3 months</span>
          <span>4+</span>
        </div>
      </section>
      {LANES.map((l) => {
        const list = lanes.get(l.id);
        if (!list?.length) return null;
        return (
          <section key={l.id} className="bat-group">
            <h3 className="label">
              {l.title} <span className="muted">{list.length}</span>
            </h3>
            <ul className="bat-list">
              {list
                .sort((a, b) => (outlooks[a.entity]?.days ?? 1e9) - (outlooks[b.entity]?.days ?? 1e9) || (a.level ?? 101) - (b.level ?? 101))
                .map((r) => (
                  <BatteryLine key={r.entity} row={r} outlook={outlooks[r.entity]} />
                ))}
            </ul>
          </section>
        );
      })}
      <p className="muted small">
        Dates come from each battery&apos;s daily level over the last four months. Many sensors report in whole-percent steps every few weeks, so a fresh battery
        needs a while before it has a date.
      </p>
    </div>
  );
}

const STATUS_COLOR: Record<BatteryRow['status'], string> = { critical: 'var(--danger)', low: 'var(--warn)', offline: 'var(--muted)', ok: 'var(--ok)' };

// The card ("Summary", the owner's pick on 2026-10-26 over a list and gauge
// tiles): a ring split by status with the counts, then only the batteries that
// need something, and which good one will run out next.
function SummaryCard({ rows }: { rows: BatteryRow[] }) {
  const outlooks = useOutlooks(rows);
  const order: BatteryRow['status'][] = ['critical', 'low', 'offline', 'ok'];
  const counts = order.map((s) => rows.filter((r) => r.status === s).length);
  const attention = rows.filter((r) => r.status !== 'ok');
  // The next replaceable battery to run out (not one that's simply recharged).
  const daysOf = (r: BatteryRow) => outlooks[r.entity]?.days ?? Infinity;
  const soon = rows.filter((r) => r.status === 'ok' && (outlooks[r.entity]?.kind === 'drain' || outlooks[r.entity]?.kind === 'slow')).sort((a, b) => daysOf(a) - daysOf(b))[0];
  const size = 96;
  const rad = 40;
  const c = 2 * Math.PI * rad;
  let at = 0;
  const needs = counts[0] + counts[1];
  return (
    <>
      <div className="bat-summary">
        <span className="bat-ring">
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
            <circle cx={size / 2} cy={size / 2} r={rad} className="bat-ring-track" />
            {order.map((s, i) => {
              const len = (counts[i] / Math.max(rows.length, 1)) * c;
              const seg = (
                <circle
                  key={s}
                  cx={size / 2}
                  cy={size / 2}
                  r={rad}
                  fill="none"
                  strokeWidth={8}
                  style={{ stroke: STATUS_COLOR[s], strokeDasharray: `${Math.max(0, len - 2)} ${c}`, strokeDashoffset: -at }}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              at += len;
              return counts[i] ? seg : null;
            })}
          </svg>
          <span className="bat-ring-text">
            <strong>{needs || rows.length}</strong>
            <small>{needs ? 'low' : 'all good'}</small>
          </span>
        </span>
        <ul className="bat-legend">
          {order.map((s, i) => (
            <li key={s} style={{ ['--c' as string]: STATUS_COLOR[s] }}>
              <i />
              <span>{{ critical: 'Almost empty', low: 'Low', offline: 'Not reporting', ok: 'Good' }[s]}</span>
              <strong>{counts[i]}</strong>
            </li>
          ))}
        </ul>
      </div>
      {attention.length > 0 ? (
        <ul className="bat-list bat-attention">
          {attention.slice(0, 4).map((r) => (
            <BatteryLine key={r.entity} row={r} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing needs a new battery.</p>
      )}
      {soon && (
        <div className="bat-next">
          <Icon name="timer" size={16} />
          <span>
            Next to go: <strong>{soon.name}</strong>, {fmtOutlook(outlooks[soon.entity]!)}
          </span>
        </div>
      )}
    </>
  );
}

export function BatteriesPanel() {
  const modal = useModal();
  const rows = useBatteries();
  const low = rows.filter((r) => r.status === 'critical' || r.status === 'low').length;
  const offline = rows.filter((r) => r.status === 'offline').length;
  const summary = !rows.length ? undefined : low ? `${low} low` : offline ? `${offline} not reporting` : 'All good';

  return (
    <section className="panel batteries-panel">
      <PanelHead
        label="Batteries"
        summary={summary}
        summaryClass={low ? 'warn' : undefined}
        onMore={() =>
          modal.open({ title: 'Batteries', icon: 'battery', accent: 'var(--accent-energy)', wide: true, subtitle: `${rows.length} devices`, body: <BatteriesDetail /> })
        }
      />
      {!rows.length ? (
        <p className="muted">No battery-powered devices found.</p>
      ) : (
        <SummaryCard rows={rows} />
      )}
    </section>
  );
}

// Home page tile (GlancePanel): a big battery icon, green when all are fine,
// orange with the number that are low (and which, up close).
export function BatteriesTile() {
  const rows = useBatteries();
  if (!rows.length) return null;
  const low = rows.filter((r) => r.status === 'critical' || r.status === 'low');
  const worst = rows.find((r) => r.level !== undefined);
  return (
    <GlanceTile
      icon="battery"
      label="Batteries"
      page="energy"
      color="var(--accent-energy)"
      tone={low.length ? 'warn' : undefined}
      value={low.length ? low.length : 'OK'}
      unit={low.length ? 'low' : undefined}
      art={
        <span className={`glance-icon ${low.length ? 'warn' : 'ok'}`}>
          <Icon name={low.length ? 'batteryLow' : 'battery'} size={40} />
        </span>
      }
      sub={low.length ? low.map((r) => r.name).join(', ') : worst ? `Lowest ${Math.round(worst.level!)}%` : undefined}
    />
  );
}
