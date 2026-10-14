import { useEffect, useMemo, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { CAR, CAR_DETAIL, HOME_ZONE } from '../config/entities';
import { useHass, type HassApi } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { isUnavailable, num, relTime } from '../ha/format';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';
import { CarScene } from '../car3d/CarScene';
import { carVisual, type CarVisual } from '../lib/carVisual';
import { ClimateControl, RemoteActions } from './CarActions';

export function distanceKm(a: HassEntity | undefined, b: HassEntity | undefined): number | undefined {
  const la1 = a?.attributes.latitude as number | undefined;
  const lo1 = a?.attributes.longitude as number | undefined;
  const la2 = b?.attributes.latitude as number | undefined;
  const lo2 = b?.attributes.longitude as number | undefined;
  if ([la1, lo1, la2, lo2].some((v) => typeof v !== 'number')) return undefined;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(la2! - la1!);
  const dLon = rad(lo2! - lo1!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(la1!)) * Math.cos(rad(la2!)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// When Kia Connect stops answering (expired login, API outage) every car
// entity goes `unavailable` and HA has no current value to show. Fall back to
// the last readings in HA's history, clearly marked as such, instead of blanks.
interface LastKnown {
  fuel?: number;
  range?: number;
  odo?: number;
  battery?: number;
  tyres?: Record<string, string | undefined>; // tyre entity -> last 'on' (low) / 'off'
  at?: number; // epoch ms of the newest reading
}

const TYRES = () => [CAR_DETAIL.tyres.frontLeft, CAR_DETAIL.tyres.frontRight, CAR_DETAIL.tyres.rearLeft, CAR_DETAIL.tyres.rearRight];

// One lookup shared by the card and the detail modal. The 14-day history query
// takes seconds on the Pi; with a fetch per component the modal opened blank
// and filled in late. Reused for 10 minutes; dropped when the car is back.
let shared: { value: LastKnown; fetchedAt: number } | null = null;
let inflight: Promise<LastKnown> | null = null;

function loadLastKnown(hass: HassApi): Promise<LastKnown> {
  if (shared && Date.now() - shared.fetchedAt < 10 * 60_000) return Promise.resolve(shared.value);
  if (!inflight) {
    inflight = Promise.all([
      hass.fetchHistory([CAR.fuel, CAR.range, CAR.odometer, CAR_DETAIL.battery12v], 24 * 14),
      hass.fetchLastStates(TYRES(), 24 * 14),
    ])
      .then(([h, tyreStates]) => {
        const latest = (id: string) => h[id]?.[h[id].length - 1];
        const [fuel, range, odo, battery] = [CAR.fuel, CAR.range, CAR.odometer, CAR_DETAIL.battery12v].map(latest);
        const times = [fuel, range, odo].flatMap((pt) => (pt ? [pt.t] : []));
        const tyres = Object.fromEntries(TYRES().map((id) => [id, tyreStates[id]?.state]));
        const value = { fuel: fuel?.v, range: range?.v, odo: odo?.v, battery: battery?.v, tyres, at: times.length ? Math.max(...times) : undefined };
        shared = { value, fetchedAt: Date.now() };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function useLastKnown(offline: boolean): LastKnown | null {
  const hass = useHass();
  const [last, setLast] = useState<LastKnown | null>(() => (offline ? shared?.value ?? null : null));
  useEffect(() => {
    if (!offline) {
      shared = null;
      setLast(null);
      return;
    }
    let alive = true;
    loadLastKnown(hass)
      .then((v) => alive && setLast(v))
      .catch(() => alive && setLast((prev) => prev ?? {}));
    return () => {
      alive = false;
    };
  }, [offline, hass]);
  return last;
}

const fmtInt = (n: number | undefined) => (n === undefined ? '–' : Math.round(n).toString());

function useCar() {
  const lock = useEntity(CAR.lock);
  const fuel = useEntity(CAR.fuel);
  const range = useEntity(CAR.range);
  const odo = useEntity(CAR.odometer);
  const tracker = useEntity(CAR_DETAIL.location);
  const home = useEntity(HOME_ZONE);
  const updated = useEntity(CAR_DETAIL.lastUpdated);
  const engine = useEntity(CAR_DETAIL.engine);
  const battery = useEntity(CAR_DETAIL.battery12v);
  const doors = useEntities(CAR.doors);
  const warnings = useEntities(CAR.warnings.map((w) => w.entity));

  const offline = isUnavailable(lock) && isUnavailable(fuel);
  const last = useLastKnown(offline);
  const openCount = doors.filter((d) => d?.state === 'on').length;
  const activeWarnings = CAR.warnings.filter((_, i) => warnings[i]?.state === 'on');
  const km = distanceKm(tracker, home);
  const where = km === undefined ? undefined : km < 0.2 ? 'At home' : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
  const moving = engine?.state === 'on';
  return {
    lock,
    tracker,
    offline,
    openCount,
    activeWarnings,
    where,
    moving,
    locked: lock?.state === 'locked',
    // Live values, or the last known ones while offline.
    fuelPct: num(fuel) ?? last?.fuel,
    rangeKm: num(range) ?? last?.range,
    odoKm: num(odo) ?? last?.odo,
    battery12vPct: num(battery) ?? last?.battery,
    lastTyres: last?.tyres,
    // When the shown values were last fresh: the car's own timestamp, else history.
    seenAgo: relTime(updated?.state) || relTime(last?.at),
  };
}

// What the 3D model should show (lib/carVisual). Memoised on the entity
// objects, so the viewer only hears about real changes.
function useCarVisual(offline: boolean, locked: boolean | undefined, tyres: (string | undefined)[]): CarVisual {
  const st = CAR_DETAIL.status;
  const openings = useEntities(CAR.doors);
  const warnings = useEntities(CAR.warnings.map((w) => w.entity));
  const seats = st?.seats;
  const singles = useEntities(
    [CAR_DETAIL.engine, st?.headlamps, st?.airConditioner ?? CAR_DETAIL.climate, st?.defrost, st?.rearWindowHeater, st?.steeringHeater, seats?.frontLeft, seats?.frontRight, seats?.rearLeft, seats?.rearRight].map(
      (id) => id ?? '',
    ),
  );
  const signals = useEntities(st?.turnSignals ?? []);
  const faults = useEntities((st?.lampFaults ?? []).map((f) => f.entity));
  const tyreKey = tyres.join();
  return useMemo(() => {
    const [engine, headlamps, ac, defrost, rearHeat, wheelHeat, sFL, sFR, sRL, sRR] = singles.map((e) => e?.state);
    return carVisual({
      offline,
      driverSide: CAR_DETAIL.model?.driverSide,
      openings: CAR.doors.map((entity, i) => ({ entity, state: openings[i]?.state })),
      tyres: { FL: tyres[0], FR: tyres[1], RL: tyres[2], RR: tyres[3] },
      locked,
      engine,
      headlamps,
      signals: signals.map((e) => e?.state),
      lampFaults: (st?.lampFaults ?? []).map((f, i) => ({ ...f, state: faults[i]?.state })),
      ac,
      defrostFront: defrost,
      defrostRear: rearHeat,
      steeringHeat: wheelHeat,
      seats: { FL: sFL, FR: sFR, RL: sRL, RR: sRR },
      warnings: CAR.warnings.map((w, i) => ({ ...w, state: warnings[i]?.state })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, locked, tyreKey, openings, warnings, singles, signals, faults]);
}

// Simple top-down silhouette for the tyre diagram.
function CarTopView() {
  return (
    <svg width="78" height="150" viewBox="0 0 78 150" aria-hidden="true">
      <rect x="4" y="22" width="9" height="26" rx="4" fill="currentColor" opacity="0.55" />
      <rect x="65" y="22" width="9" height="26" rx="4" fill="currentColor" opacity="0.55" />
      <rect x="4" y="100" width="9" height="26" rx="4" fill="currentColor" opacity="0.55" />
      <rect x="65" y="100" width="9" height="26" rx="4" fill="currentColor" opacity="0.55" />
      <rect x="10" y="4" width="58" height="142" rx="22" fill="var(--tile-hover)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      <path d="M18 44 Q39 34 60 44 L56 62 Q39 56 22 62 Z" fill="currentColor" opacity="0.35" />
      <rect x="21" y="66" width="36" height="40" rx="8" fill="currentColor" opacity="0.14" />
      <path d="M22 110 Q39 116 56 110 L59 126 Q39 132 19 126 Z" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function CarImage({ className }: { className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <Icon name="car" size={72} className={`car-fallback ${className ?? ''}`} />;
  return <img src={CAR_DETAIL.image} alt="" className={className} onError={() => setOk(false)} draggable={false} />;
}

function LockButton({ locked, disabled }: { locked: boolean; disabled: boolean }) {
  const hass = useHass();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  // Unlocking needs a second tap within 4 s; locking is immediate.
  const onClick = () => {
    if (locked && !confirm) return setConfirm(true);
    setConfirm(false);
    hass.callService('lock', locked ? 'unlock' : 'lock', {}, { entity_id: CAR.lock });
  };
  return (
    <button className={`big-btn ${confirm ? 'confirm' : ''}`} onClick={onClick} disabled={disabled}>
      <Icon name={locked ? 'unlock' : 'lock'} size={24} />
      {confirm ? 'Tap again to unlock' : locked ? 'Unlock' : 'Lock'}
    </button>
  );
}

// `last` is the last known state, used while the car is offline (dimmed).
function Tyre({ entity, label, last }: { entity: string; label: string; last?: string }) {
  const e = useEntity(entity);
  const live = !isUnavailable(e);
  const state = live ? e!.state : last;
  const low = state === 'on';
  return (
    <div className={`tyre ${low ? 'low' : ''} ${!live && state ? 'last-known' : ''}`}>
      <div className="label">{label}</div>
      <div className="tyre-val">{state === undefined ? '–' : low ? 'Low' : 'OK'}</div>
    </div>
  );
}

function Opening({ entities, name }: { entities: string[]; name: string }) {
  const states = useEntities(entities);
  const unknown = states.every(isUnavailable);
  const open = states.some((s) => s?.state === 'on');
  return (
    <span className={`chip ${unknown ? '' : open ? 'warn' : 'ok'}`}>
      <Icon name={open ? 'alert' : 'tick'} size={14} /> {name} {unknown ? 'unknown' : open ? 'open' : 'closed'}
    </span>
  );
}

function OfflineNotice({ seenAgo }: { seenAgo: string }) {
  return (
    <div className="notice-banner">
      <Icon name="alert" size={18} />
      <span>
        <strong>Kia Connect isn't responding.</strong> {seenAgo ? `Showing the last readings, from ${seenAgo}. ` : ''}
        This usually means the integration needs signing in again: in Home Assistant, open Settings → Devices &amp; services → Kia
        Connect and reconfigure it.
      </span>
    </div>
  );
}

function CarDetail() {
  const hass = useHass();
  const car = useCar();
  const climate = useEntity(CAR_DETAIL.climate);
  const updated = useEntity(CAR_DETAIL.lastUpdated);
  const locationAt = useEntity(CAR_DETAIL.status?.locationUpdated);
  const tyres = useEntities(TYRES());
  const tyreState = (i: number) => (isUnavailable(tyres[i]) ? car.lastTyres?.[TYRES()[i]] : tyres[i]?.state);
  const anyTyre = tyres.some((_, i) => tyreState(i) === 'on');
  const tyresFromHistory = car.offline && tyres.some((_, i) => isUnavailable(tyres[i]) && tyreState(i) !== undefined);
  const fuelPct = car.fuelPct;
  const visual = useCarVisual(car.offline, car.offline ? undefined : car.locked, TYRES().map((_, i) => tyreState(i)));
  const lat = car.tracker?.attributes.latitude as number | undefined;
  const lng = car.tracker?.attributes.longitude as number | undefined;

  const model = CAR_DETAIL.model;
  const heroNums = (
    <div className="car-hero-nums">
      <span className="hero-pct">{fmtInt(car.fuelPct)}<sup>%</sup></span>
      <span className="hero-range"><strong>{fmtInt(car.rangeKm)}</strong><span className="muted">km range</span></span>
    </div>
  );
  const fuelBar = <div className="progress thick"><i className={fuelPct !== undefined && fuelPct <= 15 ? 'low' : ''} style={{ width: `${fuelPct ?? 0}%` }} /></div>;

  return (
    <div className="car-detail">
      {car.offline && <OfflineNotice seenAgo={car.seenAgo} />}
      {/* With a 3D model the hero becomes a full-width stage above both columns. */}
      {model && (
        <div className="car-hero car-stage">
          {heroNums}
          <CarScene model={model} fallback={<CarImage className="car-hero-img" />} visual={visual} />
          {fuelBar}
        </div>
      )}
      <div className="car-left">
        {!model && (
          <div className="car-hero">
            {heroNums}
            <CarImage className="car-hero-img" />
            {fuelBar}
          </div>
        )}
        <div className="stat-tiles three">
          <div className="stat-tile"><div className="label">Fuel</div><div className="stat-val">{fmtInt(car.fuelPct)}<small>%</small></div></div>
          <div className="stat-tile"><div className="label">Odometer</div><div className="stat-val">{car.odoKm !== undefined ? Math.round(car.odoKm).toLocaleString() : '–'}<small>km</small></div></div>
          <div className="stat-tile"><div className="label">12V battery</div><div className="stat-val">{fmtInt(car.battery12vPct)}<small>%</small></div></div>
        </div>
        <div className="comfort">
          <div className="comfort-head">
            <h3>Comfort</h3>
            <span className="muted small">Remote climate runs for a limited time, then the car switches it off</span>
          </div>
          {CAR_DETAIL.actions?.climate ? (
            <ClimateControl />
          ) : (
            <button
              className={`action ${climate?.state === 'on' ? 'active' : ''}`}
              style={{ ['--tint' as string]: 'var(--accent-fan)' }}
              disabled={isUnavailable(climate)}
              onClick={() => hass.callService('switch', 'toggle', {}, { entity_id: CAR_DETAIL.climate })}
            >
              <span className="action-icon"><Icon name="ac" size={24} /></span>
              <span className="action-label">Climate</span>
              <span className="action-sub">{isUnavailable(climate) ? 'Unavailable' : climate?.state === 'on' ? 'Running' : 'Pre-cool the cabin'}</span>
            </button>
          )}
        </div>
        <RemoteActions updatedState={updated?.state} />
      </div>

      <div className="car-right">
        <div className="car-status card">
          <header className="panel-head">
            <h2 className="label">Car status</h2>
            {anyTyre && <span className="chip warn">{tyresFromHistory ? 'Low tyre (last known)' : 'Tyre check suggested'}</span>}
            {car.activeWarnings.map((w) => <span key={w.entity} className="chip warn">{w.name}</span>)}
          </header>
          <div className="tyre-grid">
            <Tyre entity={CAR_DETAIL.tyres.frontLeft} label="Front left" last={car.lastTyres?.[CAR_DETAIL.tyres.frontLeft]} />
            <div className="car-top"><CarTopView /></div>
            <Tyre entity={CAR_DETAIL.tyres.frontRight} label="Front right" last={car.lastTyres?.[CAR_DETAIL.tyres.frontRight]} />
            <Tyre entity={CAR_DETAIL.tyres.rearLeft} label="Rear left" last={car.lastTyres?.[CAR_DETAIL.tyres.rearLeft]} />
            <Tyre entity={CAR_DETAIL.tyres.rearRight} label="Rear right" last={car.lastTyres?.[CAR_DETAIL.tyres.rearRight]} />
          </div>
          {tyresFromHistory && <div className="muted small tyre-note">Tyre pressure: last known{car.seenAgo ? `, from ${car.seenAgo}` : ''}</div>}
          <div className="chips-row">
            {CAR_DETAIL.openings.map((o) => <Opening key={o.name} {...o} />)}
          </div>
        </div>
        <div className="car-actions">
          <div>
            <div className="label">{car.offline ? 'Status' : car.moving ? 'Driving' : 'Parked'}</div>
            <div className="car-lock-state">{car.offline ? 'Offline' : car.locked ? 'Locked' : 'Unlocked'}</div>
            <div className="muted small">
              {car.offline ? 'Lock and doors unknown' : car.openCount ? `${car.openCount} opening${car.openCount > 1 ? 's' : ''} open` : 'Everything is closed'}
            </div>
          </div>
          <button
            className="big-btn square"
            disabled={lat === undefined}
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank')}
          >
            <Icon name="pin" size={24} />
            Find car
            {relTime(locationAt?.state) && <span className="find-age">{relTime(locationAt?.state)}</span>}
          </button>
          <LockButton locked={car.locked} disabled={car.offline} />
        </div>
      </div>
    </div>
  );
}

export function CarPanel() {
  const modal = useModal();
  const car = useCar();
  const fuelPct = car.fuelPct;
  const status = car.offline ? 'Offline' : car.moving ? 'Driving' : 'Parked';

  const openDetail = () =>
    modal.open({
      title: CAR.name,
      icon: 'car',
      accent: 'var(--accent-energy)',
      wide: true,
      subtitle: (
        <span>
          <span className={`dot ${car.offline ? 'off' : 'on'}`} /> <strong>{status}</strong>
          <span className="muted">
            {car.offline ? ' · lock and doors unknown' : ` · ${car.locked ? 'Locked' : 'Unlocked'}, ${car.openCount ? `${car.openCount} open` : 'all closed'}`}
          </span>
        </span>
      ),
      aside: (
        <span className="pill small-pill">
          <span className={`dot ${car.offline ? 'off' : 'on'}`} />
          {car.offline ? (car.seenAgo ? `Last data ${car.seenAgo}` : 'No data') : `Connected${car.where ? ` · ${car.where}` : ''}`}
        </span>
      ),
      body: <CarDetail />,
    });

  return (
    <section className={`panel car-panel ${car.offline ? 'offline' : ''}`}>
      <PanelHead label={CAR.name} summary={car.offline ? (car.seenAgo ? `Offline · ${car.seenAgo}` : 'Offline') : car.where ?? status} onMore={openDetail} />
      <div className="car-summary" onClick={openDetail} role="button" tabIndex={0}>
        <div>
          <div className="hero-pct">{fmtInt(car.fuelPct)}<sup>%</sup></div>
          <div className="muted">{fmtInt(car.rangeKm)} km range</div>
        </div>
        <CarImage className="car-thumb" />
      </div>
      <div className="progress thick"><i className={fuelPct !== undefined && fuelPct <= 15 ? 'low' : ''} style={{ width: `${fuelPct ?? 0}%` }} /></div>
      <div className="chips-row">
        {car.offline ? (
          <span className="chip big warn" onClick={openDetail} role="button" tabIndex={0}>
            <Icon name="alert" size={16} /> Kia Connect not responding
          </span>
        ) : (
          <>
            <span className={`chip big ${car.locked ? 'ok' : 'warn'}`}><Icon name={car.locked ? 'lock' : 'unlock'} size={16} /> {car.locked ? 'Locked' : 'Unlocked'}</span>
            {car.activeWarnings.length > 0 && <span className="chip big warn"><Icon name="alert" size={16} /> {car.activeWarnings[0].name}</span>}
            {car.activeWarnings.length === 0 && car.odoKm !== undefined && <span className="chip big">{Math.round(car.odoKm).toLocaleString()} km</span>}
          </>
        )}
      </div>
    </section>
  );
}
