import { useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import { ALERTS, APPLIANCES, DOORBELL, ROOMS } from '../src/config/entities';
import { mockNotify } from './notify';

// Alerts test panel (preview builds, like the car test panel; open at once with
// ?alertsTest): fires notify.* calls the way HA's automations do, to see the
// full-screen alerts mirror them (alarms too: the example config's ALERTS.alarms
// has 'shoe rack'), plus the dashboard's own washer and door alerts.
export const ALERTS_TEST = new URLSearchParams(window.location.search).has('alertsTest');

const PHONE_SENSOR = 'sensor.phone_last_notification';
const LIVE_APPS = ['com.application.zomato', 'in.swiggy.android', 'com.example.ridenow'];

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
  // A real press is a one-second pulse.
  const doorbell = () => {
    if (!DOORBELL.press) return;
    patch(DOORBELL.press, { state: 'on' });
    window.setTimeout(() => patch(DOORBELL.press!, { state: 'off' }), 1_000);
  };
  // The overlay covers this panel, so the door closes by itself to show the
  // alert taking itself down (dismissWhen).
  const door = ROOMS.flatMap((r) => r.doors)[0];
  const doorLeftOpen = () => {
    if (!door) return;
    patch(door, { state: 'off' });
    window.setTimeout(() => patch(door, { state: 'on', last_changed: new Date(Date.now() - (ALERTS.doorOpenMinutes + 1) * 60_000).toISOString() }), 100);
    window.setTimeout(() => patch(door, { state: 'off' }), 6_000);
  };
  const doorOpenedAlarm = () => {
    if (!door) return;
    patch(door, { state: 'on' });
    mockNotify('notify', {
      title: 'Front door opened 🚪',
      message: 'It closes in 4 s and this alarm goes with it.',
      data: { dashboard: 'alarm', dashboard_dismiss: { entity_id: door, state: 'off' } },
    });
    window.setTimeout(() => patch(door, { state: 'off' }), 4_000);
  };

  // What the Android companion app's "Last notification" sensor reports while an
  // app tracks something, then when the app replaces it with an ordinary notification.
  const tracking = (pkg: string, title: string, text: string, progress: number) =>
    patch(PHONE_SENSOR, { state: text, attributes: { package: pkg, post_time: Date.now(), is_ongoing: true, 'android.requestPromotedOngoing': true, 'android.title': title, 'android.text': text, 'android.progress': progress, 'android.progressMax': 100 } });
  const finished = (pkg: string) =>
    patch(PHONE_SENSOR, { state: 'Order delivered', attributes: { package: pkg, post_time: Date.now(), is_ongoing: false, 'android.requestPromotedOngoing': false, 'android.title': 'Tip your delivery partner', 'android.text': 'Order delivered' } });
  const delivered = () => LIVE_APPS.forEach((pkg, i) => window.setTimeout(() => finished(pkg), i * 100));

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
            <button className="chip-btn small" onClick={doorOpenedAlarm}>
              Door alarm (gone when it closes)
            </button>
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Live Update on a phone</div>
          <div className="car-test-chips">
            <button className="chip-btn small" onClick={() => tracking(LIVE_APPS[0], 'Order is being prepared', 'Your order will arrive in 25 mins', 30)}>
              Tracking starts
            </button>
            <button className="chip-btn small" onClick={() => tracking(LIVE_APPS[0], 'Arriving now', 'Coming to your doorstep', 95)}>
              Almost there
            </button>
            <button className="chip-btn small" onClick={() => tracking(LIVE_APPS[1], 'Out for delivery', 'Rider is 2 km away', 60)}>
              Second app
            </button>
            <button className="chip-btn small" onClick={() => tracking(LIVE_APPS[2], 'Driver is on the way', 'Arriving in 4 mins', 45)}>
              Third app (no logo)
            </button>
            <button className="chip-btn small" onClick={delivered}>
              Delivered (all go)
            </button>
          </div>
        </div>
        <div className="car-test-group">
          <div className="car-test-title">Dashboard's own</div>
          <div className="car-test-chips">
            <button className="chip-btn small" onClick={washerDone} title={denied ? undefined : 'Stands down while HA notifications are mirrored; try ?mockNotify=denied'}>
              Washer done{denied ? '' : ' (off while mirroring)'}
            </button>
            <button className="chip-btn small" onClick={doorLeftOpen}>
              Door left open (closes in 6 s)
            </button>
            <button className="chip-btn small" onClick={doorbell}>
              Doorbell
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
