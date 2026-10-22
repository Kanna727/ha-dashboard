import { useState } from 'react';
import { VACATION_MODE } from '../config/entities';
import { useHass } from '../ha/api';
import { useEntities } from '../ha/store';
import { isOn } from '../ha/format';
import { Icon } from './Icon';

const useVacation = () => {
  const hass = useHass();
  const [state] = useEntities([VACATION_MODE]);
  const set = (on: boolean) => hass.callService('input_boolean', on ? 'turn_on' : 'turn_off', {}, { entity_id: VACATION_MODE });
  return { on: !!VACATION_MODE && isOn(state), set };
};

// Status-bar toggle. Turning it on asks first, full screen; while it is on the
// whole dashboard sits behind <VacationLock />, whose button is the way off.
export function VacationButton() {
  const { on, set } = useVacation();
  const [asking, setAsking] = useState(false);
  if (!VACATION_MODE) return null;
  const label = on ? 'Vacation mode is on' : 'Turn on vacation mode';
  return (
    <>
      <button className={`pill icon-pill vacation-mode ${on ? 'on' : ''}`} onClick={() => !on && setAsking(true)} aria-label={label} title={label}>
        <Icon name="vacation" size={22} />
      </button>
      {asking && !on && (
        <div className="vacation-screen" role="alertdialog" aria-modal="true" aria-label="Turn on vacation mode?">
          <div className="vacation-box">
            <Icon name="vacation" size={64} />
            <h2>Turn on vacation mode?</h2>
            <p>The dashboard will be locked behind a full-screen message until vacation mode is turned off.</p>
            <div className="vacation-actions">
              <button className="v-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button
                className="v-btn primary"
                onClick={() => {
                  set(true);
                  setAsking(false);
                }}
              >
                Turn on
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Covers everything (above night mode and modals) while vacation mode is on.
export function VacationLock() {
  const { on, set } = useVacation();
  if (!on) return null;
  return (
    <div className="vacation-screen locked" role="alertdialog" aria-modal="true" aria-label="Vacation mode is on">
      <div className="vacation-box">
        <Icon name="vacation" size={80} />
        <h2>Vacation mode is on</h2>
        <p>The dashboard is locked while the house is on vacation mode.</p>
        <div className="vacation-actions">
          <button className="v-btn primary" onClick={() => set(false)}>Turn off vacation mode</button>
        </div>
      </div>
    </div>
  );
}
