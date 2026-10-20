// The car's discovered extras (panels/useCarExtras.ts, lib/carInfo.ts) as UI:
// trips and monthly totals, the service schedule, cabin air, where it is.
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useMemo, useState } from 'react';
import { CAR } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntities } from '../ha/store';
import { num, relTime } from '../ha/format';
import { Icon } from '../components/Icon';
import { CAR_EXTRA_KEYS, fmtMinutes, pm25Band, serviceText, shortPlace, tripEvents, type CarExtraKey, type ServiceItem } from '../lib/carInfo';
import { DRIVE_DAYS, driveBuckets, driveSummary, type DriveBucket, type DriveMetric, type DrivePeriod, type StatChangeLike } from '../lib/driveHistory';

export type CarSensors = Partial<Record<CarExtraKey, HassEntity>>;

// Live states of the discovered sensors, keyed by what they are.
export function useCarSensors(ids: Partial<Record<CarExtraKey, string>>): CarSensors {
  const states = useEntities(CAR_EXTRA_KEYS.map((k) => ids[k] ?? ''));
  return useMemo(() => Object.fromEntries(CAR_EXTRA_KEYS.map((k, i) => [k, states[i]]).filter(([, e]) => e)) as CarSensors, [states]);
}

export const n = (x: CarSensors, k: CarExtraKey) => num(x[k]);
export const kmText = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v).toLocaleString()} km`);
export const timeOf = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : undefined;
  return d && Number.isFinite(d.getTime()) ? d : undefined;
};

export function placeOf(x: CarSensors): string | undefined {
  const g = x.geocoded_location;
  return shortPlace(g?.state, g?.attributes.address);
}

export function CabinAirTile({ x }: { x: CarSensors }) {
  const v = n(x, 'cabin_pm2_5');
  if (!x.cabin_pm2_5) return null;
  const band = v === undefined ? undefined : pm25Band(v);
  const at = relTime(x.cabin_pm2_5.attributes.measured_at as string | undefined);
  return (
    <div className={`stat-tile cabin-air ${band?.tone ?? ''}`}>
      <div className="label">Cabin air</div>
      <div className="stat-val">{v === undefined ? '–' : Math.round(v)}<small>µg/m³</small></div>
      <div className="stat-rule">{[band ? `PM2.5 · ${band.label}` : 'PM2.5', at].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

export function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// Modal: the last trip with its driving events, then today and this month.
export const speedText = (x: CarSensors, k: CarExtraKey) => (n(x, k) === undefined ? '–' : `${Math.round(n(x, k)!)} km/h`);
export const hasTrips = (x: CarSensors) => !!(x.last_trip_distance || x.distance_today || x.distance_this_month);

// "Tue 20 Oct · 3:43 PM – 4:13 PM", from the last trip's start and end.
export function tripWhen(x: CarSensors): string {
  const start = timeOf(x.last_trip_start?.state);
  const end = timeOf(x.last_trip_end?.state);
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start) return `${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${t(start)}${end ? ` – ${t(end)}` : ''}`;
  return end ? relTime(end.toISOString()) : '';
}

export function TripEvents({ x }: { x: CarSensors }) {
  const events = tripEvents(n(x, 'last_trip_hard_braking'), n(x, 'last_trip_rapid_acceleration'), n(x, 'last_trip_speeding'));
  if (!events.length) return null;
  return (
    <div className="chips-row">
      {events.map((e) => (
        <span key={e.label} className={`chip ${e.count ? 'warn' : 'ok'}`}>
          <Icon name={e.count ? 'alert' : 'tick'} size={14} /> {e.label}
        </span>
      ))}
    </div>
  );
}

export function LastTripCard({ x }: { x: CarSensors }) {
  if (!x.last_trip_distance) return null;
  const when = tripWhen(x);
  return (
    <div className="card trip-card">
      <div className="trip-head">
        <span className="label">Last trip</span>
        {when && <span className="muted small">{when}</span>}
      </div>
      <div className="trip-nums">
        <div><Icon name="road" size={18} /><strong>{kmText(n(x, 'last_trip_distance'))}</strong></div>
        <div>
          <Icon name="timer" size={18} />
          <strong>{fmtMinutes(n(x, 'last_trip_drive_time'))}</strong>
          {n(x, 'last_trip_idle_time') ? <span className="muted small">{fmtMinutes(n(x, 'last_trip_idle_time'))} idle</span> : null}
        </div>
        <div>
          <Icon name="speed" size={18} />
          <strong>{speedText(x, 'last_trip_average_speed')}</strong>
          {x.last_trip_top_speed && <span className="muted small">top {speedText(x, 'last_trip_top_speed')}</span>}
        </div>
      </div>
      <TripEvents x={x} />
    </div>
  );
}

export function TodayCard({ x }: { x: CarSensors }) {
  if (!x.distance_today && !x.trips_today) return null;
  return (
    <div className="card">
      <div className="label">Today</div>
      <Kv label="Distance" value={kmText(n(x, 'distance_today'))} />
      <Kv label="Trips" value={n(x, 'trips_today') === undefined ? '–' : String(Math.round(n(x, 'trips_today')!))} />
      <Kv label="Driving" value={fmtMinutes(n(x, 'drive_time_today'))} />
    </div>
  );
}

export function MonthCard({ x }: { x: CarSensors }) {
  if (!x.distance_this_month && !x.trips_this_month) return null;
  return (
    <div className="card">
      <div className="label">This month</div>
      <Kv label="Distance" value={kmText(n(x, 'distance_this_month'))} />
      <Kv label="Trips" value={n(x, 'trips_this_month') === undefined ? '–' : String(Math.round(n(x, 'trips_this_month')!))} />
      <Kv label="Driving" value={fmtMinutes(n(x, 'drive_time_this_month'))} />
      {x.idle_time_this_month && <Kv label="Idling" value={fmtMinutes(n(x, 'idle_time_this_month'))} />}
      {x.average_speed_this_month && <Kv label="Average" value={speedText(x, 'average_speed_this_month')} />}
      {x.top_speed_this_month && <Kv label="Top speed" value={speedText(x, 'top_speed_this_month')} />}
    </div>
  );
}

// Modal: the last trip, today and this month, then the history chart.
export function DrivingSection({ x }: { x: CarSensors }) {
  return (
    <div className="car-driving">
      {hasTrips(x) && (
        <>
          <LastTripCard x={x} />
          <div className="trip-periods">
            <TodayCard x={x} />
            <MonthCard x={x} />
          </div>
        </>
      )}
      <DriveHistory x={x} />
    </div>
  );
}

// Modal: maintenance items, most urgent first, with how much of each interval is used.
export function ServiceCard({ items }: { items: ServiceItem[] }) {
  if (!items.length) return null;
  const due = items.filter((s) => s.due).length;
  return (
    <div className="car-service card">
      <header className="panel-head">
        <h2 className="label">Service</h2>
        <span className={`chip ${due ? 'warn' : 'ok'}`}>
          <Icon name={due ? 'service' : 'tick'} size={14} /> {due ? `${due} due` : 'Nothing due'}
        </span>
      </header>
      <div className="service-list">
        {items.map((s) => (
          <div key={s.entity} className={`service-row ${s.due ? 'due' : ''}`}>
            <div className="service-text">
              <span className="service-name">{s.name}</span>
              <span className="muted small">{serviceText(s)}</span>
            </div>
            <div className="progress"><i style={{ width: `${Math.max(3, s.used * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Modal footer: what the car is, and how fresh its data is.
export function VehicleLine({ x, updatedAt }: { x: CarSensors; updatedAt?: string }) {
  const a = x.vehicle_identification_number?.attributes ?? {};
  const what = [a.model_year, a.trim, a.exterior_color].filter((v) => typeof v === 'number' || (typeof v === 'string' && v)).join(' · ');
  const fresh = [relTime(updatedAt) && `Data from the car ${relTime(updatedAt)}`, relTime(x.last_scanned_at?.state) && `checked ${relTime(x.last_scanned_at?.state)}`]
    .filter(Boolean)
    .join(', ');
  if (!what && !fresh) return null;
  return (
    <div className="car-vehicle muted small">
      {what && <span>{what}</span>}
      {fresh && <span>{fresh}</span>}
    </div>
  );
}

const PERIODS: { id: DrivePeriod; label: string; unit: string }[] = [
  { id: 'day', label: 'Days', unit: 'day' },
  { id: 'week', label: 'Weeks', unit: 'week' },
  { id: 'month', label: 'Months', unit: 'month' },
];
const METRICS: { id: DriveMetric; label: string }[] = [
  { id: 'km', label: 'Distance' },
  { id: 'trips', label: 'Trips' },
  { id: 'minutes', label: 'Drive time' },
];

const metricText = (m: DriveMetric, v: number | undefined) =>
  v === undefined ? '–' : m === 'km' ? `${Math.round(v).toLocaleString()} km` : m === 'trips' ? `${Math.round(v)} trip${Math.round(v) === 1 ? '' : 's'}` : fmtMinutes(v);

function bucketLabel(b: DriveBucket, p: DrivePeriod): string {
  const d = new Date(b.start);
  if (p === 'day') return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (p === 'week') return `Week of ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

// A short label under some bars: Mondays for days, the first week of a month, every month.
function axisLabel(b: DriveBucket, p: DrivePeriod, i: number, count: number): string {
  const d = new Date(b.start);
  if (p === 'day') return d.getDay() === 1 ? String(d.getDate()) : '';
  if (p === 'week') return d.getDate() <= 7 ? d.toLocaleDateString([], { month: 'short' }) : '';
  return count > 12 && i % 2 ? '' : d.toLocaleDateString([], { month: 'short' });
}

// Driving history: distance, trips and drive time per day, week or month,
// from long-term statistics (lib/driveHistory.ts), so it reaches back to when
// the odometer was first recorded.
export function DriveHistory({ x }: { x: CarSensors }) {
  const hass = useHass();
  const [period, setPeriod] = useState<DrivePeriod>('day');
  const [metric, setMetric] = useState<DriveMetric>('km');
  // Daily rows for up to two years, fetched once; every view is built from them.
  const [rows, setRows] = useState<{ km?: StatChangeLike[]; trips?: StatChangeLike[]; minutes?: StatChangeLike[] } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const tripsId = x.trips_today?.entity_id;
  const minutesId = x.drive_time_today?.entity_id;

  useEffect(() => {
    if (!CAR.odometer) return;
    let alive = true;
    const ids = [CAR.odometer, tripsId, minutesId].filter((id): id is string => !!id);
    hass
      .fetchStatChanges(ids, DRIVE_DAYS, 'day')
      .then((r) => alive && setRows({ km: r[CAR.odometer], trips: tripsId ? r[tripsId] : undefined, minutes: minutesId ? r[minutesId] : undefined }))
      .catch(() => alive && setRows({}));
    return () => {
      alive = false;
    };
  }, [hass, tripsId, minutesId]);

  const buckets = useMemo(() => (rows ? driveBuckets(period, Date.now(), rows.km, rows.trips, rows.minutes) : undefined), [rows, period]);
  if (buckets && !buckets.length) return null; // no long-term statistics for the odometer
  const metrics = METRICS.filter((m) => m.id === 'km' || buckets?.some((b) => b[m.id] !== undefined));
  const shownMetric = metrics.some((m) => m.id === metric) ? metric : 'km';
  const values = (buckets ?? []).map((b) => b[shownMetric]);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const idx = picked !== null && buckets && picked < buckets.length ? picked : (buckets?.length ?? 1) - 1;
  const sel = buckets?.[idx];
  const sum = buckets ? driveSummary(buckets, shownMetric) : undefined;
  const unit = PERIODS.find((p) => p.id === period)!.unit;

  return (
    <div className="card drive-history">
      <div className="dh-head">
        <span className="label">Driving history</span>
        <div className="dh-seg" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => { setPeriod(p.id); setPicked(null); }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {metrics.length > 1 && (
        <div className="dh-metrics">
          {metrics.map((m) => (
            <button key={m.id} className={`chip-btn small ${shownMetric === m.id ? 'active' : ''}`} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      {!buckets ? (
        <div className="dh-loading muted small">Loading…</div>
      ) : (
        <>
          <div className="dh-chart">
            <div className="dh-bars" role="list">
              {buckets.map((b, i) => {
                const v = b[shownMetric];
                return (
                  <button
                    key={b.start}
                    role="listitem"
                    className={`dh-bar ${b.partial ? 'partial' : ''} ${v === undefined ? 'none' : ''} ${i === idx ? 'picked' : ''}`}
                    style={{ ['--h' as string]: `${((v ?? 0) / max) * 100}%` }}
                    onClick={() => setPicked(i)}
                    aria-label={`${bucketLabel(b, period)}: ${metricText(shownMetric, v)}`}
                  >
                    <i />
                  </button>
                );
              })}
            </div>
            <div className="dh-axis" aria-hidden="true">
              {buckets.map((b, i) => (
                <span key={b.start}>{axisLabel(b, period, i, buckets.length)}</span>
              ))}
            </div>
          </div>
          {sel && (
            <div className="dh-picked">
              <span className="muted small">{bucketLabel(sel, period)}{sel.partial ? ' · so far' : ''}</span>
              <div className="dh-picked-vals">
                <strong>{metricText('km', sel.km)}</strong>
                {sel.trips !== undefined && <span>{metricText('trips', sel.trips)}</span>}
                {sel.minutes !== undefined && <span>{metricText('minutes', sel.minutes)}</span>}
              </div>
            </div>
          )}
          {sum && (
            <div className="dh-summary muted small">
              <span>Total {metricText(shownMetric, sum.total)}</span>
              {sum.average !== undefined && <span>avg {metricText(shownMetric, sum.average)} a {unit}</span>}
              {sum.best && <span>busiest {bucketLabel(sum.best, period)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
