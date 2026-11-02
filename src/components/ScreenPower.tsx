import { useEffect, useMemo } from 'react';
import { ROOMS, SCREEN_POWER, VACATION_MODE } from '../config/entities';
import { isOn } from '../ha/format';
import { useEntities, useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { inQuietHours, screenOn, sinceSeenMs } from '../lib/screenPower';

// ?screenTest=1: quiet hours all day and a 15 s hold, for checking it on the tablet.
const TEST = new URLSearchParams(window.location.search).has('screenTest');

// Tells the ChromeOS extension (kiosk-extension/) whether the wall screen should
// stay on (rules in lib/screenPower.ts). Sent as a window message on every
// change and once a minute, since the extension's worker may have restarted.
// Without the extension nobody listens and nothing happens. Renders nothing.
export function ScreenPower() {
  const ids = useMemo(
    () => ROOMS.filter((r) => !SCREEN_POWER.rooms || SCREEN_POWER.rooms.includes(r.id)).flatMap((r) => r.presence),
    [],
  );
  const sensors = useEntities(ids);
  const vacation = useEntity(VACATION_MODE || undefined);
  const now = useNow(TEST ? 1000 : 15_000);

  const on =
    !SCREEN_POWER.enabled ||
    screenOn({
      quiet: TEST || inQuietHours(now, SCREEN_POWER.quiet),
      vacation: SCREEN_POWER.vacation && isOn(vacation),
      sinceSeenMs: sinceSeenMs(sensors, now.getTime()),
      holdMinutes: TEST ? 0.25 : SCREEN_POWER.holdMinutes,
    });

  useEffect(() => {
    document.documentElement.dataset.screen = on ? 'on' : 'off';
    const send = () => window.postMessage({ source: 'ha-dashboard', type: 'screen', on }, window.location.origin);
    send();
    const id = window.setInterval(send, 60_000);
    return () => window.clearInterval(id);
  }, [on]);

  // The extension answers each message; note once that it's there.
  useEffect(() => {
    const onReply = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'ha-dashboard-screen') return;
      window.removeEventListener('message', onReply);
      console.info(`Screen power extension connected (wake ${e.data.canWake ? 'supported' : 'not supported'}).`);
    };
    window.addEventListener('message', onReply);
    return () => window.removeEventListener('message', onReply);
  }, []);

  return null;
}
