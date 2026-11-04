import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ROOMS, SCREEN_POWER, VACATION_MODE } from '../config/entities';
import { isOn } from '../ha/format';
import { useEntities, useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { inQuietHours, screenOn, sinceSeenMs } from '../lib/screenPower';
import { useDoorbellRinging } from './Doorbell';

// ?screenTest=1: quiet hours all day and a 15 s hold, for checking it on the tablet.
const TEST = new URLSearchParams(window.location.search).has('screenTest');

// Whether the wall screen should stay on (rules in lib/screenPower.ts). Also
// read by NightMode, which comes up when it may go off so the page stops
// repainting (ChromeOS won't turn off a display that looks like it plays video).
export function useScreenOn() {
  const ids = useMemo(
    () => ROOMS.filter((r) => !SCREEN_POWER.rooms || SCREEN_POWER.rooms.includes(r.id)).flatMap((r) => r.presence),
    [],
  );
  const sensors = useEntities(ids);
  const vacation = useEntity(VACATION_MODE || undefined);
  const now = useNow(TEST ? 1000 : 15_000);
  const ringing = useDoorbellRinging();

  return (
    !SCREEN_POWER.enabled ||
    ringing ||
    screenOn({
      quiet: TEST || inQuietHours(now, SCREEN_POWER.quiet),
      vacation: SCREEN_POWER.vacation && isOn(vacation),
      sinceSeenMs: sinceSeenMs(sensors, now.getTime()),
      holdMinutes: TEST ? 0.25 : SCREEN_POWER.holdMinutes,
    })
  );
}

// Whether the extension has answered: this device is the wall screen, whatever
// its layout (NightMode then comes up on any layout when the screen may go off).
let extension = false;
const extensionListeners = new Set<() => void>();
const subscribeExtension = (l: () => void) => {
  extensionListeners.add(l);
  return () => {
    extensionListeners.delete(l);
  };
};
export const useScreenExtension = () => useSyncExternalStore(subscribeExtension, () => extension);

// Tells the ChromeOS extension (kiosk-extension/) whether the wall screen should
// stay on. Sent as a window message on every change and once a minute, since
// the extension's worker may have restarted. Without the extension nobody
// listens and nothing happens. Renders nothing.
export function ScreenPower() {
  const on = useScreenOn();

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
      extension = true;
      extensionListeners.forEach((l) => l());
    };
    window.addEventListener('message', onReply);
    return () => window.removeEventListener('message', onReply);
  }, []);

  return null;
}
