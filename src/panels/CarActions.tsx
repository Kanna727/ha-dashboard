import { useEffect, useRef, useState } from 'react';
import { CAR, CAR_DETAIL } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { isUnavailable, relTime } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';

// A second tap within 4 s confirms (unlock, horn, hazards, valet).
function useArm(): [boolean, (on: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return [armed, setArmed];
}

const fmtTemp = (t: number) => `${t % 1 ? t.toFixed(1) : t}°`;

// Remote climate with a target temperature (CAR_DETAIL.actions.climate, a
// climate.* entity). The stepper is local until Start/Set sends it, so tapping
// + three times doesn't wake the car three times.
function useClimate() {
  const hass = useHass();
  const id = CAR_DETAIL.actions?.climate;
  const c = useEntity(id);
  const [temp, setTemp] = useState<number>();
  const min = Number(c?.attributes.min_temp ?? 14);
  const max = Number(c?.attributes.max_temp ?? 30);
  const step = Number(c?.attributes.target_temp_step ?? 0.5);
  const remote = c?.attributes.temperature as number | undefined;
  const cabin = c?.attributes.current_temperature;
  const shown = temp ?? remote ?? 22;
  const unavailable = isUnavailable(c);
  const running = !unavailable && c?.state !== 'off';
  const changed = temp !== undefined && temp !== remote;

  // Forget the local value once HA reports it.
  useEffect(() => {
    if (temp !== undefined && temp === remote) setTemp(undefined);
  }, [remote, temp]);

  const bump = (d: number) => setTemp((t) => Math.min(max, Math.max(min, Math.round(((t ?? remote ?? 22) + d * step) / step) * step)));
  const main = () => {
    if (!id) return;
    if (running && !changed) hass.callService('climate', 'set_hvac_mode', { hvac_mode: 'off' }, { entity_id: id });
    else hass.callService('climate', 'set_temperature', { temperature: shown, ...(running ? {} : { hvac_mode: 'auto' }) }, { entity_id: id });
  };
  return {
    min,
    max,
    remote,
    shown,
    unavailable,
    running,
    changed,
    bump,
    main,
    cabin: typeof cabin === 'number' && Number.isFinite(cabin) ? Math.round(cabin * 10) / 10 : undefined,
  };
}

export function ClimateControl() {
  const k = useClimate();
  return (
    <div className="climate-ctl">
      <button className={`action ${k.running ? 'active' : ''}`} style={{ ['--tint' as string]: 'var(--accent-fan)' }} disabled={k.unavailable} onClick={k.main}>
        <span className="action-icon"><Icon name="ac" size={24} /></span>
        <span className="action-label">Climate</span>
        <span className="action-sub">
          {k.unavailable ? 'Unavailable' : k.running ? (k.changed ? `Tap to set ${fmtTemp(k.shown)}` : `Running · ${fmtTemp(k.remote ?? k.shown)} · tap to stop`) : `Tap to start at ${fmtTemp(k.shown)}`}
        </span>
      </button>
      <div className="temp-stepper" aria-label="Target temperature">
        <button onClick={() => k.bump(-1)} disabled={k.unavailable || k.shown <= k.min} aria-label="Cooler"><Icon name="minus" size={20} /></button>
        <span className="temp-val">{fmtTemp(k.shown)}</span>
        <button onClick={() => k.bump(1)} disabled={k.unavailable || k.shown >= k.max} aria-label="Warmer"><Icon name="plus" size={20} /></button>
      </div>
      {k.cabin !== undefined && (
        <div className="cabin-temp">
          <span className="label">Cabin</span>
          <strong>{fmtTemp(k.cabin)}</strong>
        </div>
      )}
    </div>
  );
}

// On the 3D stage (right side, below Interior): the A/C button and stepper.
// The car switches remote climate off after a while by itself.
export function StageClimate() {
  const k = useClimate();
  if (!CAR_DETAIL.actions?.climate) return null;
  return (
    <div className="stage-climate" title="Remote climate runs for a limited time, then the car switches it off">
      <button className={`stage-btn ${k.running ? 'on cool' : ''}`} disabled={k.unavailable} onClick={k.main}>
        <Icon name="ac" size={20} />
        <span className="stage-btn-text">
          <span>{k.unavailable ? 'A/C' : k.running ? (k.changed ? 'Set' : 'A/C on') : 'Start A/C'}</span>
          <small>{k.unavailable ? 'Unavailable' : k.running ? (k.changed ? `to ${fmtTemp(k.shown)}` : 'Tap to stop') : `at ${fmtTemp(k.shown)}`}</small>
        </span>
      </button>
      <div className="stage-stepper" aria-label="Target temperature">
        <button onClick={() => k.bump(-1)} disabled={k.unavailable || k.shown <= k.min} aria-label="Cooler"><Icon name="minus" size={18} /></button>
        <span>{fmtTemp(k.shown)}</span>
        <button onClick={() => k.bump(1)} disabled={k.unavailable || k.shown >= k.max} aria-label="Warmer"><Icon name="plus" size={18} /></button>
      </div>
      {k.cabin !== undefined && <span className="stage-note">Cabin {fmtTemp(k.cabin)}</span>}
    </div>
  );
}

// Refresh asks the car for fresh data; done when the car's "last updated"
// changes, or after 90 s (the car may be asleep).
function useRefresh(updatedState?: string) {
  const [refreshing, setRefreshing] = useState(false);
  const pressedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (refreshing && updatedState !== pressedAt.current) setRefreshing(false);
  }, [updatedState, refreshing]);
  useEffect(() => {
    if (!refreshing) return;
    const t = window.setTimeout(() => setRefreshing(false), 90_000);
    return () => window.clearTimeout(t);
  }, [refreshing]);
  return {
    refreshing,
    start: () => {
      pressedAt.current = updatedState;
      setRefreshing(true);
    },
  };
}

// On the 3D stage, top right (next to Interior): refresh, with the data's age.
export function StageRefresh({ updatedState }: { updatedState?: string }) {
  const hass = useHass();
  const id = CAR_DETAIL.actions?.refresh;
  const e = useEntity(id);
  const r = useRefresh(updatedState);
  if (!id) return null;
  const unavailable = isUnavailable(e) && e?.state !== 'unknown'; // buttons sit at "unknown" until pressed
  const ago = relTime(updatedState);
  return (
    <button
      className={`stage-refresh ${r.refreshing ? 'busy' : ''}`}
      disabled={unavailable || r.refreshing}
      onClick={() => {
        hass.callService('button', 'press', {}, { entity_id: id });
        r.start();
      }}
      title="Ask the car for fresh data"
    >
      <Icon name="refresh" size={18} />
      <span className="stage-btn-text">
        <span>{r.refreshing ? 'Waking car…' : 'Refresh'}</span>
        {!r.refreshing && ago && <small>Data {ago}</small>}
      </span>
    </button>
  );
}

// Valet mode has start/stop buttons but no state sensor, so the toggle shows
// what was last set from this device.
const VALET_KEY = 'carValet';
function readValet(): boolean {
  try {
    return localStorage.getItem(VALET_KEY) === 'on';
  } catch {
    return false;
  }
}

// On the 3D stage (left side, below the readings): lock, find, horn, valet, hazards.
export function StageActions({ locked, offline, findUrl, locationAge, valetStart, valetStop }: {
  locked: boolean;
  offline: boolean;
  findUrl?: string;
  locationAge?: string;
  valetStart?: string;
  valetStop?: string;
}) {
  const hass = useHass();
  const horn = CAR_DETAIL.actions?.hornHazards;
  const hornState = useEntity(horn);
  const hazards = CAR_DETAIL.actions?.hazards;
  const hazardState = useEntity(hazards);
  const [hazardArmed, armHazards] = useArm();
  const [unlockArmed, armUnlock] = useArm();
  const [hornArmed, armHorn] = useArm();
  const [valetArmed, armValet] = useArm();
  const [valet, setValet] = useState(readValet);

  const lock = () => {
    // Unlocking needs a second tap within 4 s; locking is immediate.
    if (locked && !unlockArmed) return armUnlock(true);
    armUnlock(false);
    hass.callService('lock', locked ? 'unlock' : 'lock', {}, { entity_id: CAR.lock });
  };
  const honk = () => {
    if (!horn) return;
    if (!hornArmed) return armHorn(true);
    armHorn(false);
    hass.callService('button', 'press', {}, { entity_id: horn });
  };
  const flash = () => {
    if (!hazards) return;
    if (!hazardArmed) return armHazards(true);
    armHazards(false);
    hass.callService('button', 'press', {}, { entity_id: hazards });
  };
  const toggleValet = () => {
    const target = valet ? valetStop : valetStart;
    if (!target) return;
    if (!valetArmed) return armValet(true);
    armValet(false);
    hass.callService('button', 'press', {}, { entity_id: target });
    setValet(!valet);
    try {
      localStorage.setItem(VALET_KEY, valet ? 'off' : 'on');
    } catch {
      /* storage blocked: the toggle resets on reload */
    }
  };
  // Buttons sit at "unknown" until pressed; that counts as available.
  const hornUnavailable = isUnavailable(hornState) && hornState?.state !== 'unknown';
  const hazardUnavailable = isUnavailable(hazardState) && hazardState?.state !== 'unknown';

  return (
    <div className="stage-actions">
      <StageButton
        icon={locked ? 'unlock' : 'lock'}
        label={unlockArmed ? 'Tap again' : locked ? 'Unlock' : 'Lock'}
        sub={offline ? 'Unavailable' : locked ? 'Locked now' : 'Unlocked now'}
        armed={unlockArmed}
        disabled={offline}
        onClick={lock}
      />
      <StageButton icon="pin" label="Find car" sub={locationAge || undefined} disabled={!findUrl} onClick={() => findUrl && window.open(findUrl, '_blank')} />
      {horn && <StageButton icon="horn" label={hornArmed ? 'Tap again' : 'Horn'} sub="Honk + flash" armed={hornArmed} disabled={hornUnavailable} onClick={honk} />}
      {(valetStart || valetStop) && (
        <button className={`stage-btn stage-toggle ${valet ? 'on' : ''} ${valetArmed ? 'armed' : ''}`} onClick={toggleValet} role="switch" aria-checked={valet}>
          <Icon name="valet" size={20} />
          <span className="stage-btn-text">
            <span>{valetArmed ? 'Tap again' : 'Valet mode'}</span>
            <small>{valet ? 'On' : 'Off'}</small>
          </span>
          <i className="stage-switch" aria-hidden="true" />
        </button>
      )}
      {hazards && <StageButton icon="hazard" label={hazardArmed ? 'Tap again' : 'Hazards'} sub="Flash to find it" armed={hazardArmed} disabled={hazardUnavailable} onClick={flash} />}
    </div>
  );
}

function StageButton({ icon, label, sub, armed, disabled, onClick }: { icon: IconName; label: string; sub?: string; armed?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`stage-btn ${armed ? 'armed' : ''}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={20} />
      <span className="stage-btn-text">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}

// A button.* entity press; `confirm` needs a second tap within 4 s.
function PressAction({ entity, icon, label, idle, confirm, busy, onPress }: { entity?: string; icon: IconName; label: string; idle: string; confirm?: string; busy?: string; onPress?: () => void }) {
  const hass = useHass();
  const e = useEntity(entity);
  const [arming, setArming] = useArm();
  if (!entity) return null;
  const unavailable = isUnavailable(e) && e?.state !== 'unknown'; // buttons sit at "unknown" until first pressed
  const press = () => {
    if (confirm && !arming) return setArming(true);
    setArming(false);
    hass.callService('button', 'press', {}, { entity_id: entity });
    onPress?.();
  };
  return (
    <button className={`action ${arming ? 'warn' : ''} ${busy ? 'active' : ''}`} style={{ ['--tint' as string]: 'var(--accent-energy)' }} disabled={unavailable || !!busy} onClick={press}>
      <span className="action-icon"><Icon name={icon} size={24} /></span>
      <span className="action-label">{label}</span>
      <span className="action-sub">{unavailable ? 'Unavailable' : busy ?? (arming ? confirm : idle)}</span>
    </button>
  );
}

// Without the 3D stage: refresh, hazards, horn and valet mode as tiles.
// Valet mode start/stop buttons are discovered on the car's device (useCarExtras).
export function RemoteActions({ updatedState, valetStart, valetStop }: { updatedState?: string; valetStart?: string; valetStop?: string }) {
  const a = CAR_DETAIL.actions;
  const { refreshing, start } = useRefresh(updatedState);
  if (!a?.refresh && !a?.hazards && !a?.hornHazards && !valetStart && !valetStop) return null;
  const ago = relTime(updatedState);

  return (
    <div className="car-remote">
      <h3>Remote</h3>
      <div className="car-remote-grid">
        <PressAction
          entity={a?.refresh}
          icon="refresh"
          label="Refresh"
          idle={ago ? `Data ${ago}` : 'Fetch fresh data'}
          busy={refreshing ? 'Waking car…' : undefined}
          onPress={start}
        />
        <PressAction entity={a?.hazards} icon="hazard" label="Hazards" idle="Find the car" confirm="Tap again" />
        <PressAction entity={a?.hornHazards} icon="horn" label="Horn" idle="Honk + flash" confirm="Tap again" />
        <PressAction entity={valetStart} icon="valet" label="Valet on" idle="Start valet mode" confirm="Tap again" />
        <PressAction entity={valetStop} icon="valet" label="Valet off" idle="End valet mode" confirm="Tap again" />
      </div>
    </div>
  );
}
