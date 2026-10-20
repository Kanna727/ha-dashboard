import { useRef, useState, type ReactNode } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { CAR, CAR_DETAIL } from '../src/config/entities';
import { store, useEntities, useEntity } from '../src/ha/store';
import { openingPart } from '../src/lib/carVisual';
import { useCarExtras, useCarService } from '../src/panels/useCarExtras';

// ?carTest (mock builds; the local and deployed previews show its chip by
// default): toggles for every car state the card, the photo and the 3D model
// react to: openings, lock, engine, lamps, tyres, warnings, heaters, service,
// fuel and the "Kia Connect not responding" state. Only the mock's states change.
export const CAR_TEST = new URLSearchParams(window.location.search).has('carTest') || import.meta.env.VITE_PREVIEW === '1';

type Patch = (id: string, update: Partial<HassEntity> & { attributes?: Record<string, unknown> }) => void;

const OPENING: Record<string, string> = { FL: 'Front left door', FR: 'Front right door', RL: 'Rear left door', RR: 'Rear right door', hood: 'Bonnet', trunk: 'Tailgate' };
const SEATS = ['Off', 'Low', 'Medium', 'High'];
const signalName = (id: string) => `${/right/.test(id) ? 'Right' : 'Left'} ${/rear|back/.test(id) ? 'rear' : 'front'}`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="car-test-group">
      <div className="car-test-title">{title}</div>
      <div className="car-test-chips">{children}</div>
    </div>
  );
}

export function CarTestPanel({ patch }: { patch: Patch }) {
  const [open, setOpen] = useState(new URLSearchParams(window.location.search).has('carTest'));
  // Each entity's state before the panel first touched it, for Reset.
  const original = useRef(new Map<string, { state: string; attributes: Record<string, unknown> }>());
  const found = useCarExtras();
  const { service, problems } = useCarService(found);
  const st = CAR_DETAIL.status;
  const lock = useEntity(CAR.lock);
  const fuel = useEntity(CAR.fuel);

  const set = (id: string | undefined, state: string, attributes?: Record<string, unknown>) => {
    if (!id) return;
    const prev = store.getAll()[id];
    if (!prev) return;
    if (!original.current.has(id)) original.current.set(id, { state: prev.state, attributes: prev.attributes });
    patch(id, { state, attributes });
  };
  const reset = () => {
    for (const [id, o] of original.current) patch(id, { state: o.state, attributes: o.attributes });
    original.current.clear();
  };

  // Binary toggles: on/off (or any two states).
  const binaries = [
    ...CAR.doors,
    CAR_DETAIL.engine,
    st?.headlamps,
    ...(st?.turnSignals ?? []),
    found.sensors.hazard_lights,
    ...(st?.lampFaults ?? []).map((f) => f.entity),
    ...Object.values(CAR_DETAIL.tyres),
    ...CAR.warnings.map((w) => w.entity),
    ...problems.map((p) => p.entity),
    st?.airConditioner,
    st?.defrost,
    st?.rearWindowHeater,
    st?.steeringHeater,
  ].filter((id): id is string => !!id);
  const states = useEntities(binaries);
  const on = (id: string | undefined) => !!id && states[binaries.indexOf(id)]?.state === 'on';
  const Toggle = ({ id, label }: { id?: string; label: string }) =>
    id ? (
      <button className={`chip-btn small ${on(id) ? 'armed' : ''}`} onClick={() => set(id, on(id) ? 'off' : 'on')}>
        {label}
      </button>
    ) : null;

  const seatIds = st?.seats ? (Object.entries(st.seats).filter(([, id]) => id) as [string, string][]) : [];
  const seatStates = useEntities(seatIds.map(([, id]) => id));
  const offline = lock?.state === 'unavailable';
  const offlineIds = [CAR.lock, CAR.fuel, CAR.range, CAR.odometer];

  const setService = (due: boolean, s: (typeof service)[number]) =>
    set(s.entity, due ? 'on' : 'off', {
      remaining_km: due ? -500 : Math.round((s.intervalKm ?? 10000) / 2),
      ...(s.intervalMonths ? { remaining_months: due ? -1 : Math.round(s.intervalMonths / 2) } : {}),
    });

  const allWarnings = () => {
    if (lock?.state !== 'unavailable') set(CAR.lock, 'unlocked');
    for (const id of [...CAR.doors, ...Object.values(CAR_DETAIL.tyres), ...CAR.warnings.map((w) => w.entity), ...problems.map((p) => p.entity), ...(st?.lampFaults ?? []).map((f) => f.entity)]) set(id, 'on');
    set(found.sensors.hazard_lights, 'on');
    for (const s of service) setService(true, s);
    set(CAR.fuel, '9');
  };

  if (!open) {
    return (
      <button className="car-test car-test-chip" onClick={() => setOpen(true)}>
        Car test
      </button>
    );
  }

  return (
    <div className="car-test" role="group" aria-label="Car test">
      <div className="sky-test-head">
        <strong>Car test</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </div>
      <div className="car-test-actions">
        <button className="sky-test-btn" onClick={allWarnings}>All warnings</button>
        <button className="sky-test-btn" onClick={reset}>Reset</button>
      </div>
      <div className="car-test-body">
        <Group title="Connection">
          <button
            className={`chip-btn small ${offline ? 'armed' : ''}`}
            onClick={() => (offline ? offlineIds.forEach((id) => set(id, original.current.get(id)?.state ?? 'on')) : offlineIds.forEach((id) => set(id, 'unavailable')))}
          >
            Kia Connect offline
          </button>
          <button
            className={`chip-btn small ${lock?.state === 'unlocked' ? 'armed' : ''}`}
            disabled={offline}
            onClick={() => set(CAR.lock, lock?.state === 'unlocked' ? 'locked' : 'unlocked')}
          >
            Unlocked
          </button>
          <Toggle id={CAR_DETAIL.engine} label="Engine running" />
        </Group>
        <Group title="Openings">
          {CAR.doors.map((id) => <Toggle key={id} id={id} label={OPENING[openingPart(id) ?? ''] ?? id} />)}
        </Group>
        <Group title="Tyres (low)">
          <Toggle id={CAR_DETAIL.tyres.frontLeft} label="Front left" />
          <Toggle id={CAR_DETAIL.tyres.frontRight} label="Front right" />
          <Toggle id={CAR_DETAIL.tyres.rearLeft} label="Rear left" />
          <Toggle id={CAR_DETAIL.tyres.rearRight} label="Rear right" />
        </Group>
        <Group title="Warnings">
          {CAR.warnings.map((w) => <Toggle key={w.entity} id={w.entity} label={w.name} />)}
          {problems.map((p) => <Toggle key={p.entity} id={p.entity} label={p.name} />)}
        </Group>
        <Group title="Lamps">
          <Toggle id={st?.headlamps} label="Headlamps" />
          <Toggle id={found.sensors.hazard_lights} label="Hazards" />
          {(st?.turnSignals ?? []).map((id) => <Toggle key={id} id={id} label={`${signalName(id)} signal`} />)}
          {(st?.lampFaults ?? []).map((f) => <Toggle key={f.entity} id={f.entity} label={`${f.name} fault`} />)}
        </Group>
        <Group title="Comfort">
          <Toggle id={st?.airConditioner} label="A/C" />
          <Toggle id={st?.defrost} label="Defrost" />
          <Toggle id={st?.rearWindowHeater} label="Rear heater" />
          <Toggle id={st?.steeringHeater} label="Steering heater" />
          {seatIds.map(([corner, id], i) => {
            const level = seatStates[i]?.state ?? 'Off';
            const next = SEATS[(SEATS.indexOf(level) + 1) % SEATS.length] ?? 'Off';
            return (
              <button key={id} className={`chip-btn small ${level !== 'Off' ? 'armed' : ''}`} onClick={() => set(id, next)}>
                Seat {corner.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}: {level}
              </button>
            );
          })}
        </Group>
        {service.length > 0 && (
          <Group title="Service due">
            {service.map((s) => (
              <button key={s.entity} className={`chip-btn small ${s.due ? 'armed' : ''}`} onClick={() => setService(!s.due, s)}>
                {s.name}
              </button>
            ))}
          </Group>
        )}
        <div className="sky-test-row">
          <span>Fuel</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Number(fuel?.state) || 0}
            disabled={offline}
            onChange={(e) => {
              const v = Number(e.target.value);
              set(CAR.fuel, String(v));
              set(CAR.range, String(Math.round(v * 8.2)));
            }}
            aria-label="Fuel"
          />
          <span className="sky-test-val">{offline ? '–' : `${fuel?.state}%`}</span>
          <span />
        </div>
      </div>
    </div>
  );
}
