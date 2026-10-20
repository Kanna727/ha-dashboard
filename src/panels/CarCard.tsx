// The car panel's body (picked by the owner from four trial designs, 2026-10-20):
// a fuel ring gauge beside the photo, four status icons, warning chips for
// anything else, and one trip line. Tapping the top opens the detail popup.
import { num, relTime } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';
import { fmtMinutes } from '../lib/carInfo';
import { CarImage, fmtInt, type CarData } from './CarPanel';

const warningIcon = (entity: string): IconName =>
  /tire|tyre/i.test(entity) ? 'tyre' : /fuel/i.test(entity) ? 'fuel' : /washer/i.test(entity) ? 'washerFluid' : /brake/i.test(entity) ? 'brakeFluid' : /key/i.test(entity) ? 'keyAlert' : /oil|coolant/i.test(entity) ? 'engine' : 'alert';

const km = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v).toLocaleString()} km`);

// "Last trip 14 km, 32 min, 2h ago · 912 km this month"
function tripLine(car: CarData): string {
  const x = car.x;
  const parts: string[] = [];
  if (x.last_trip_distance) {
    parts.push(`Last trip ${[km(num(x.last_trip_distance)), num(x.last_trip_drive_time) !== undefined ? fmtMinutes(num(x.last_trip_drive_time)) : '', relTime(x.last_trip_end?.state)].filter(Boolean).join(', ')}`);
  }
  if (x.distance_this_month) parts.push(`${km(num(x.distance_this_month))} this month`);
  return parts.join(' · ');
}

function FuelRing({ pct, range }: { pct?: number; range?: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const low = pct !== undefined && pct <= 15;
  return (
    <div className="fuel-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="fuel-ring-track" />
        <circle cx="60" cy="60" r={r} className={`fuel-ring-arc ${low ? 'low' : ''}`} strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="fuel-ring-text">
        <strong>{fmtInt(pct)}<sup>%</sup></strong>
        <span>{fmtInt(range)} km</span>
      </div>
    </div>
  );
}

function StatusIcon({ icon, label, sub, warn }: { icon: IconName; label: string; sub: string; warn: boolean }) {
  return (
    <div className={`status-icon ${warn ? 'warn' : 'ok'}`}>
      <span className="status-icon-dot"><Icon name={icon} size={20} /></span>
      <span className="status-icon-label">{label}</span>
      <span className="status-icon-sub">{sub}</span>
    </div>
  );
}

export function CarCard({ car, open }: { car: CarData; open: () => void }) {
  const tyreWarn = car.activeWarnings.some((w) => /tire|tyre/i.test(w.entity));
  const other = car.activeWarnings.filter((w) => !/tire|tyre/i.test(w.entity));
  // While offline, lock and doors are unknown (never shown as locked/closed).
  const unknown = car.offline;
  const trip = tripLine(car);
  return (
    <>
      <div className="cb-top" onClick={open} role="button" tabIndex={0}>
        <FuelRing pct={car.fuelPct} range={car.rangeKm} />
        <CarImage className="car-thumb" />
      </div>
      <div className="cb-status">
        <StatusIcon icon={car.locked || unknown ? 'lock' : 'unlock'} label="Lock" sub={unknown ? 'Unknown' : car.locked ? 'Locked' : 'Unlocked'} warn={!unknown && !car.locked} />
        <StatusIcon icon="carDoor" label="Doors" sub={unknown ? 'Unknown' : car.openNames.length ? `${car.openNames.length} open` : 'Closed'} warn={!unknown && car.openNames.length > 0} />
        <StatusIcon icon="tyre" label="Tyres" sub={tyreWarn ? 'Check' : 'OK'} warn={tyreWarn} />
        <StatusIcon icon="service" label="Service" sub={car.serviceDue.length ? `${car.serviceDue.length} due` : 'OK'} warn={car.serviceDue.length > 0} />
      </div>
      {(car.offline || car.hazards || other.length > 0) && (
        <div className="chips-row">
          {car.offline && <span className="chip warn"><Icon name="alert" size={14} /> Kia Connect not responding</span>}
          {car.hazards && <span className="chip warn"><Icon name="hazard" size={14} /> Hazards on</span>}
          {other.map((w) => <span key={w.entity} className="chip warn"><Icon name={warningIcon(w.entity)} size={14} /> {w.name}</span>)}
        </div>
      )}
      {trip && <div className="cb-trip muted small">{trip}</div>}
    </>
  );
}
