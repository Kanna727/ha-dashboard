import { useEffect, useRef, useState } from 'react';
import { CAR_DETAIL } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { isUnavailable, relTime } from '../ha/format';
import { Icon, type IconName } from '../components/Icon';

// Remote climate with a target temperature (CAR_DETAIL.actions.climate, a
// climate.* entity). The stepper is local until Start/Set sends it, so tapping
// + three times doesn't wake the car three times.
export function ClimateControl() {
  const hass = useHass();
  const id = CAR_DETAIL.actions?.climate;
  const c = useEntity(id);
  const [temp, setTemp] = useState<number>();
  const min = Number(c?.attributes.min_temp ?? 14);
  const max = Number(c?.attributes.max_temp ?? 30);
  const step = Number(c?.attributes.target_temp_step ?? 0.5);
  const remote = c?.attributes.temperature as number | undefined;
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
  const fmt = (t: number) => `${t % 1 ? t.toFixed(1) : t}°`;

  return (
    <div className="climate-ctl">
      <button className={`action ${running ? 'active' : ''}`} style={{ ['--tint' as string]: 'var(--accent-fan)' }} disabled={unavailable} onClick={main}>
        <span className="action-icon"><Icon name="ac" size={24} /></span>
        <span className="action-label">Climate</span>
        <span className="action-sub">
          {unavailable ? 'Unavailable' : running ? (changed ? `Tap to set ${fmt(shown)}` : `Running · ${fmt(remote ?? shown)} · tap to stop`) : `Tap to start at ${fmt(shown)}`}
        </span>
      </button>
      <div className="temp-stepper" aria-label="Target temperature">
        <button onClick={() => bump(-1)} disabled={unavailable || shown <= min} aria-label="Cooler"><Icon name="minus" size={20} /></button>
        <span className="temp-val">{fmt(shown)}</span>
        <button onClick={() => bump(1)} disabled={unavailable || shown >= max} aria-label="Warmer"><Icon name="plus" size={20} /></button>
      </div>
    </div>
  );
}

// A button.* entity press; `confirm` needs a second tap within 4 s.
function PressAction({ entity, icon, label, idle, confirm, busy, onPress }: { entity?: string; icon: IconName; label: string; idle: string; confirm?: string; busy?: string; onPress?: () => void }) {
  const hass = useHass();
  const e = useEntity(entity);
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = window.setTimeout(() => setArming(false), 4000);
    return () => window.clearTimeout(t);
  }, [arming]);
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

// Force refresh, hazards and horn (CAR_DETAIL.actions).
export function RemoteActions({ updatedState }: { updatedState?: string }) {
  const a = CAR_DETAIL.actions;
  const [refreshing, setRefreshing] = useState(false);
  const pressedAt = useRef<string | undefined>(undefined);
  // Done when the car's "last updated" changes, or after 90 s (the car may be asleep).
  useEffect(() => {
    if (refreshing && updatedState !== pressedAt.current) setRefreshing(false);
  }, [updatedState, refreshing]);
  useEffect(() => {
    if (!refreshing) return;
    const t = window.setTimeout(() => setRefreshing(false), 90_000);
    return () => window.clearTimeout(t);
  }, [refreshing]);
  if (!a?.refresh && !a?.hazards && !a?.hornHazards) return null;
  const ago = relTime(updatedState);

  return (
    <div className="car-remote">
      <h3>Remote</h3>
      <div className="car-remote-grid">
        <PressAction
          entity={a.refresh}
          icon="refresh"
          label="Refresh"
          idle={ago ? `Data ${ago}` : 'Fetch fresh data'}
          busy={refreshing ? 'Waking car…' : undefined}
          onPress={() => {
            pressedAt.current = updatedState;
            setRefreshing(true);
          }}
        />
        <PressAction entity={a.hazards} icon="hazard" label="Hazards" idle="Find the car" confirm="Tap again" />
        <PressAction entity={a.hornHazards} icon="horn" label="Horn" idle="Honk + flash" confirm="Tap again" />
      </div>
    </div>
  );
}
