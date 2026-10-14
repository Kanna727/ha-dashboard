import { CLIMATE } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntity } from '../ha/store';
import { fmtNum, isUnavailable } from '../ha/format';
import { Icon } from './Icon';

const MODE_LABEL: Record<string, string> = { off: 'Off', cool: 'Cool', dry: 'Dry', fan_only: 'Fan', auto: 'Auto', heat: 'Heat' };
const MIN = 16;
const MAX = 30;

export function ClimateCard() {
  const hass = useHass();
  const ac = useEntity(CLIMATE.entity);
  const energy = useEntity(CLIMATE.energyToday);
  const pm = useEntity(CLIMATE.pm25);
  const target = { entity_id: CLIMATE.entity };

  if (isUnavailable(ac)) {
    return (
      <section className="card climate">
        <header className="card-head"><Icon name="ac" size={18} /><h2>Air Conditioner</h2></header>
        <p className="muted">AC offline</p>
      </section>
    );
  }

  const a = ac!.attributes;
  const on = ac!.state !== 'off';
  const setpoint = a.temperature as number | null;
  const modes = ((a.hvac_modes as string[]) ?? []).filter((m) => m !== 'off');
  const fanModes = (a.fan_modes as string[]) ?? [];

  const setTemp = (t: number) => hass.callService('climate', 'set_temperature', { temperature: Math.min(MAX, Math.max(MIN, t)) }, target);

  return (
    <section className={`card climate ${on ? 'on' : ''}`}>
      <header className="card-head">
        <Icon name="ac" size={18} />
        <h2>Air Conditioner</h2>
        <button
          className={`round small ${on ? 'active' : ''}`}
          aria-label={on ? 'Turn AC off' : 'Turn AC on'}
          onClick={() => hass.callService('climate', on ? 'turn_off' : 'turn_on', {}, target)}
        >
          <Icon name="power" size={18} />
        </button>
      </header>
      <div className="climate-body">
        <button className="round" disabled={!on || setpoint == null} onClick={() => setpoint != null && setTemp(setpoint - 1)} aria-label="Lower temperature">
          <Icon name="minus" />
        </button>
        <div className="setpoint">
          <div className="big">{on && setpoint != null ? `${setpoint}°` : '–'}</div>
          <div className="muted small">Room {a.current_temperature ?? '–'}°</div>
        </div>
        <button className="round" disabled={!on || setpoint == null} onClick={() => setpoint != null && setTemp(setpoint + 1)} aria-label="Raise temperature">
          <Icon name="plus" />
        </button>
      </div>
      <div className="chips-row">
        {modes.map((m) => (
          <button key={m} className={`chip-btn ${ac!.state === m ? 'active' : ''}`} onClick={() => hass.callService('climate', 'set_hvac_mode', { hvac_mode: m }, target)}>
            {MODE_LABEL[m] ?? m}
          </button>
        ))}
      </div>
      {on && fanModes.length > 0 && (
        <div className="chips-row">
          <span className="muted small">Fan</span>
          {fanModes.map((m) => (
            <button key={m} className={`chip-btn small ${a.fan_mode === m ? 'active' : ''}`} onClick={() => hass.callService('climate', 'set_fan_mode', { fan_mode: m }, target)}>
              {m}
            </button>
          ))}
        </div>
      )}
      <div className="stat-row">
        <span><span className="muted small">Today</span> {fmtNum(energy, 2)} kWh</span>
        <span><span className="muted small">PM2.5</span> {fmtNum(pm)}</span>
      </div>
    </section>
  );
}
