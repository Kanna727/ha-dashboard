// The car popup's information below the 3D stage (picked by the owner from four
// trial layouts, 2026-10-20): this month's numbers as tiles, the driving history
// chart beside the last trip, and the service schedule as ring gauges.
import { Icon } from '../components/Icon';
import { fmtMinutes, serviceText, type ServiceItem } from '../lib/carInfo';
import { DriveHistory, kmText, LastTripCard, n, speedText, type CarSensors } from './CarInfo';

const count = (v: number | undefined) => (v === undefined ? '–' : String(Math.round(v)));

// How much of a service interval is used, as a ring; orange when due.
function ServiceRing({ s }: { s: ServiceItem }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`svc-ring ${s.due ? 'due' : ''}`} width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="svc-ring-track" />
      <circle cx="22" cy="22" r={r} className="svc-ring-arc" strokeDasharray={`${Math.max(0.03, s.used) * c} ${c}`} transform="rotate(-90 22 22)" />
      <text x="22" y="26" textAnchor="middle">{Math.round(s.used * 100)}</text>
    </svg>
  );
}

function ServiceGrid({ items }: { items: ServiceItem[] }) {
  if (!items.length) return null;
  const due = items.filter((s) => s.due).length;
  return (
    <div className="card svc-card">
      <header className="panel-head">
        <h2 className="label">Service</h2>
        <span className={`chip ${due ? 'warn' : 'ok'}`}>
          <Icon name={due ? 'service' : 'tick'} size={14} /> {due ? `${due} due` : 'Nothing due'}
        </span>
      </header>
      <div className="svc-grid">
        {items.map((s) => (
          <div key={s.entity} className={`svc-item ${s.due ? 'due' : ''}`}>
            <ServiceRing s={s} />
            <div className="svc-text">
              <span className="svc-name">{s.name}</span>
              <span className="muted small">{serviceText(s)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// This month's readings as tiles; distance, trips and drive time also say today's.
function MonthTiles({ x }: { x: CarSensors }) {
  if (!x.distance_this_month && !x.trips_this_month) return null;
  const tiles: [string, string, string | undefined][] = [
    ['Distance', kmText(n(x, 'distance_this_month')), x.distance_today ? `${kmText(n(x, 'distance_today'))} today` : undefined],
    ['Trips', count(n(x, 'trips_this_month')), x.trips_today ? `${count(n(x, 'trips_today'))} today` : undefined],
    ['Driving', fmtMinutes(n(x, 'drive_time_this_month')), x.drive_time_today ? `${fmtMinutes(n(x, 'drive_time_today'))} today` : undefined],
    ['Idling', fmtMinutes(n(x, 'idle_time_this_month')), undefined],
    ['Average', speedText(x, 'average_speed_this_month'), undefined],
    ['Top speed', speedText(x, 'top_speed_this_month'), undefined],
  ];
  return (
    <div className="kpi-strip">
      <span className="label">This month</span>
      <div className="kpi-tiles">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="stat-tile">
            <div className="label">{label}</div>
            <div className="stat-val">{value}</div>
            {sub && <div className="stat-rule">{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CarDetailsInfo({ x, service }: { x: CarSensors; service: ServiceItem[] }) {
  return (
    <div className="car-info">
      <MonthTiles x={x} />
      <div className="car-info-main">
        <DriveHistory x={x} />
        <div className="car-info-side">
          <LastTripCard x={x} />
        </div>
      </div>
      <ServiceGrid items={service} />
    </div>
  );
}
