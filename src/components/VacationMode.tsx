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

// Status-bar toggle. Turning it on asks first, full screen; turning it off is one tap.
export function VacationButton() {
  const { on, set } = useVacation();
  const [asking, setAsking] = useState(false);
  if (!VACATION_MODE) return null;
  const label = on ? 'Vacation mode is on: tap to turn off' : 'Turn on vacation mode';
  return (
    <>
      <button className={`pill icon-pill vacation-mode ${on ? 'on' : ''}`} onClick={() => (on ? set(false) : setAsking(true))} aria-label={label} title={label}>
        <Icon name="vacation" size={22} />
      </button>
      {asking && !on && (
        <div className="vacation-screen" role="alertdialog" aria-modal="true" aria-label="Turn on vacation mode?">
          <div className="vacation-box">
            <Icon name="vacation" size={64} />
            <h2>Turn on vacation mode?</h2>
            <p>Your automations will treat the house as being on vacation until you turn it off again.</p>
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
