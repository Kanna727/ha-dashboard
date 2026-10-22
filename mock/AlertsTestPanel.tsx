import { useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { ALERTS, APPLIANCES, ROOMS } from '../src/config/entities';
import { mockNotify } from './notify';

// Alerts test panel (preview builds, like the car test panel; open at once with
// ?alertsTest): fires notify.* calls the way HA's automations do, to see the
// full-screen alerts mirror them (alarms too: the example config's ALERTS.alarms
// has 'shoe rack'), plus the dashboard's own washer and door alerts.
export const ALERTS_TEST = new URLSearchParams(window.location.search).has('alertsTest');

type Patch = (id: string, update: Partial<HassEntity> & { attributes?: Record<string, unknown> }) => void;
type Call = [service: string, data: Record<string, unknown>];

const SAMPLES: { label: string; calls: Call[] }[] = [
  { label: 'Laundry done', calls: [['notify', { message: 'Laundry is done! 🧺' }]] },
  { label: 'Title + text', calls: [['notify', { title: 'Laundry Reminder 🧺', message: 'Clean laundry has been waiting in the washing machine for 40 minutes!' }]] },
  {
    label: 'Alarm (shoe rack, to two phones)',
    calls: [
      ['mobile_app_phone', { title: 'Shoe Rack', message: 'A shoe rack door was opened.' }],
      ['mobile_app_tablet', { title: 'Shoe Rack', message: 'A shoe rack door was opened.' }],
    ],
  },
  { label: 'Alarm (sent as one)', calls: [['notify', { title: 'Water leak 💧', message: 'Water detected under the kitchen sink.', data: { channel: 'alarm_stream' } }]] },
  { label: 'Warning', calls: [['notify', { message: '⚠️ Fridge door has been left open for 2 minutes!' }]] },
  {
    label: 'Three at once',
    calls: [
      ['notify', { message: 'Dishwasher is done! 🍽️' }],
      ['notify', { message: 'Geyser turned off — water is hot! ♨️' }],
      ['mobile_app_phone', { title: 'Front door', message: 'The front door was unlocked.' }],
    ],
  },
  { label: 'TV only (ignored)', calls: [['tv', { message: '🚪 Main door opened' }]] },
];

export function AlertsTestPanel({ patch }: { patch: Patch }) {
  const [open, setOpen] = useState(ALERTS_TEST);
  const denied = new URLSearchParams(window.location.search).get('mockNotify') === 'denied';

  const washerDone = () => {
    patch(APPLIANCES.washer.running, { state: 'on' });
    window.setTimeout(() => patch(APPLIANCES.washer.running, { state: 'off' }), 300);
  };
  const doorLeftOpen = () => {
    const door = ROOMS.flatMap((r) => r.doors)[0];
    if (!door) return;
    patch(door, { state: 'off' });
    window.setTimeout(() => patch(door, { state: 'on', last_changed: new Date(Date.now() - (ALERTS.doorOpenMinutes + 1) * 60_000).toISOString() }), 100);
  };

  if (!open) {
    return (
      <button className="car-test car-test-chip alerts-test" onClick={() => setOpen(true)}>
        Alerts test
      </button>
    );
  }
  return (
    <div className="car-test" role="group" aria-label="Alerts test">
      <div className="sky-test-head">
        <strong>Alerts test</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimise">
          –
        </button>
      </div>
      <div className="car-test-body">
        <div className="car-test-group">
          <div className="car-test-title">From Home Assistant{denied ? ' (off: ?mockNotify=denied)' : ''}</div>
          <div className="car-test-chips">
            {SAMPLES.map((s) => (
              <button key={s.label} className="chip-btn small" onClick={() => s.calls.forEach(([service, data]) => mockNotify(service, data))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Dashboard's own</div>
          <div className="car-test-chips">
            <button className="chip-btn small" onClick={washerDone} title={denied ? undefined : 'Stands down while HA notifications are mirrored; try ?mockNotify=denied'}>
              Washer done{denied ? '' : ' (off while mirroring)'}
            </button>
            <button className="chip-btn small" onClick={doorLeftOpen}>
              Door left open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
