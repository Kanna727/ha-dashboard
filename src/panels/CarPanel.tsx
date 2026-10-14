import { useEffect, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { CAR, CAR_DETAIL, HOME_ZONE } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntities, useEntity } from '../ha/store';
import { fmtNum, isUnavailable, num, relTime } from '../ha/format';
import { Icon } from '../components/Icon';
import { PanelHead, useModal } from '../components/Modal';

function distanceKm(a: HassEntity | undefined, b: HassEntity | undefined): number | undefined {
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

function useCar() {
  const lock = useEntity(CAR.lock);
  const fuel = useEntity(CAR.fuel);
  const range = useEntity(CAR.range);
  const odo = useEntity(CAR.odometer);
  const tracker = useEntity(CAR_DETAIL.location);
  const home = useEntity(HOME_ZONE);
  const updated = useEntity(CAR_DETAIL.lastUpdated);
  const engine = useEntity(CAR_DETAIL.engine);
  const doors = useEntities(CAR.doors);
  const warnings = useEntities(CAR.warnings.map((w) => w.entity));

  const offline = isUnavailable(lock) && isUnavailable(fuel);
  const openCount = doors.filter((d) => d?.state === 'on').length;
  const activeWarnings = CAR.warnings.filter((_, i) => warnings[i]?.state === 'on');
  const km = distanceKm(tracker, home);
  const where = km === undefined ? undefined : km < 0.2 ? 'At home' : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
  const moving = engine?.state === 'on';
  return { lock, fuel, range, odo, tracker, updated, offline, openCount, activeWarnings, where, moving, locked: lock?.state === 'locked' };
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

function LockButton({ locked }: { locked: boolean }) {
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
    <button className={`big-btn ${confirm ? 'confirm' : ''}`} onClick={onClick}>
      <Icon name={locked ? 'unlock' : 'lock'} size={24} />
      {confirm ? 'Tap again to unlock' : locked ? 'Unlock' : 'Lock'}
    </button>
  );
}

function Tyre({ entity, label }: { entity: string; label: string }) {
  const e = useEntity(entity);
  const low = e?.state === 'on';
  return (
    <div className={`tyre ${low ? 'low' : ''}`}>
      <div className="label">{label}</div>
      <div className="tyre-val">{isUnavailable(e) ? '–' : low ? 'Low' : 'OK'}</div>
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

function CarDetail() {
  const hass = useHass();
  const car = useCar();
  const battery = useEntity(CAR_DETAIL.battery12v);
  const climate = useEntity(CAR_DETAIL.climate);
  const tyreWarn = [CAR_DETAIL.tyres.frontLeft, CAR_DETAIL.tyres.frontRight, CAR_DETAIL.tyres.rearLeft, CAR_DETAIL.tyres.rearRight];
  const tyres = useEntities(tyreWarn);
  const anyTyre = tyres.some((t) => t?.state === 'on');
  const fuelPct = num(car.fuel);
  const lat = car.tracker?.attributes.latitude as number | undefined;
  const lng = car.tracker?.attributes.longitude as number | undefined;

  return (
    <div className="car-detail">
      <div className="car-left">
        <div className="car-hero">
          <div className="car-hero-nums">
            <span className="hero-pct">{fmtNum(car.fuel)}<sup>%</sup></span>
            <span className="hero-range"><strong>{fmtNum(car.range)}</strong><span className="muted">km range</span></span>
          </div>
          <CarImage className="car-hero-img" />
          <div className="progress thick"><i className={fuelPct !== undefined && fuelPct <= 15 ? 'low' : ''} style={{ width: `${fuelPct ?? 0}%` }} /></div>
        </div>
        <div className="stat-tiles three">
          <div className="stat-tile"><div className="label">Fuel</div><div className="stat-val">{fmtNum(car.fuel)}<small>%</small></div></div>
          <div className="stat-tile"><div className="label">Odometer</div><div className="stat-val">{num(car.odo)?.toLocaleString() ?? '–'}<small>km</small></div></div>
          <div className="stat-tile"><div className="label">12V battery</div><div className="stat-val">{fmtNum(battery)}<small>%</small></div></div>
        </div>
        <div className="comfort">
          <div className="comfort-head">
            <h3>Comfort</h3>
            <span className="muted small">Remote climate runs for a limited time, then the car switches it off</span>
          </div>
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
        </div>
      </div>

      <div className="car-right">
        <div className="car-status card">
          <header className="panel-head">
            <h2 className="label">Car status</h2>
            {anyTyre && <span className="chip warn">Tyre check suggested</span>}
            {car.activeWarnings.map((w) => <span key={w.entity} className="chip warn">{w.name}</span>)}
          </header>
          <div className="tyre-grid">
            <Tyre entity={CAR_DETAIL.tyres.frontLeft} label="Front left" />
            <div className="car-top"><CarTopView /></div>
            <Tyre entity={CAR_DETAIL.tyres.frontRight} label="Front right" />
            <Tyre entity={CAR_DETAIL.tyres.rearLeft} label="Rear left" />
            <Tyre entity={CAR_DETAIL.tyres.rearRight} label="Rear right" />
          </div>
          <div className="chips-row">
            {CAR_DETAIL.openings.map((o) => <Opening key={o.name} {...o} />)}
          </div>
        </div>
        <div className="car-actions">
          <div>
            <div className="label">{car.moving ? 'Driving' : 'Parked'}</div>
            <div className="car-lock-state">{car.offline ? 'Offline' : car.locked ? 'Locked' : 'Unlocked'}</div>
            <div className="muted small">{car.openCount ? `${car.openCount} opening${car.openCount > 1 ? 's' : ''} open` : 'Everything is closed'}</div>
          </div>
          <button
            className="big-btn square"
            disabled={lat === undefined}
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank')}
          >
            <Icon name="pin" size={24} />
            Find car
          </button>
          <LockButton locked={car.locked} />
        </div>
      </div>
    </div>
  );
}

export function CarPanel() {
  const modal = useModal();
  const car = useCar();
  const fuelPct = num(car.fuel);
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
          <span className="muted"> · {car.locked ? 'Locked' : 'Unlocked'}, {car.openCount ? `${car.openCount} open` : 'all closed'}</span>
        </span>
      ),
      aside: (
        <span className="pill small-pill">
          <span className={`dot ${car.offline ? 'off' : 'on'}`} />
          {car.offline ? `Last seen ${relTime(car.updated?.state)}` : `Connected${car.where ? ` · ${car.where}` : ''}`}
        </span>
      ),
      body: <CarDetail />,
    });

  return (
    <section className={`panel car-panel ${car.offline ? 'offline' : ''}`}>
      <PanelHead label={CAR.name} summary={car.offline ? `Updated ${relTime(car.updated?.state)}` : car.where ?? status} onMore={openDetail} />
      <div className="car-summary" onClick={openDetail} role="button" tabIndex={0}>
        <div>
          <div className="hero-pct">{fmtNum(car.fuel)}<sup>%</sup></div>
          <div className="muted">{fmtNum(car.range)} km range</div>
        </div>
        <CarImage className="car-thumb" />
      </div>
      <div className="progress thick"><i className={fuelPct !== undefined && fuelPct <= 15 ? 'low' : ''} style={{ width: `${fuelPct ?? 0}%` }} /></div>
      <div className="chips-row">
        <span className={`chip big ${car.locked ? 'ok' : 'warn'}`}><Icon name={car.locked ? 'lock' : 'unlock'} size={16} /> {car.locked ? 'Locked' : 'Unlocked'}</span>
        {car.activeWarnings.length > 0 && <span className="chip big warn"><Icon name="alert" size={16} /> {car.activeWarnings[0].name}</span>}
        {car.activeWarnings.length === 0 && car.odo && <span className="chip big">{num(car.odo)?.toLocaleString() ?? '–'} km</span>}
      </div>
    </section>
  );
}
