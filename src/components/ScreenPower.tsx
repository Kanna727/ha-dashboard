import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ROOMS, SCREEN_POWER, VACATION_MODE } from '../config/entities';
import { useHass } from '../ha/api';
import { isOn } from '../ha/format';
import { useEntities, useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { batteryToWrite, effectiveOn, entityStep, inQuietHours, screenOn, sinceSeenMs, type Override } from '../lib/screenPower';
import { useDoorbellRinging } from './Doorbell';

// ?screenTest=1: quiet hours all day and a 15 s hold, for checking it on the tablet.
const TEST = new URLSearchParams(window.location.search).has('screenTest');

// Whether the wall screen should stay on by the automatic rules (lib/screenPower.ts).
function useAutoScreenOn() {
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

// Shared with NightMode: whether the extension has answered (this device is
// the wall screen, whatever its layout), the screen's state (automatic, or
// hand-set on the wall screen) and the hand-set override itself.
let extension = false;
let screenOnNow = true;
let override: Override | null = null;
let batteryLevel: number | undefined; // 0–1, from the extension's answers
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useScreenExtension = () => useSyncExternalStore(subscribe, () => extension);
// NightMode comes up when the screen may go off so the page stops repainting
// (ChromeOS won't turn off a display that looks like it plays video).
export const useScreenOn = () => useSyncExternalStore(subscribe, () => screenOnNow);
// Turned off by hand: NightMode blanks the screen at once instead of after a minute.
export const useScreenOffByHand = () => useSyncExternalStore(subscribe, () => !!override && !override.on && !screenOnNow);
const useOverride = () => useSyncExternalStore(subscribe, () => override);
const useBatteryLevel = () => useSyncExternalStore(subscribe, () => batteryLevel);
export function setScreenOverride(o: Override | null) {
  override = o;
  notify();
}

// Tells the ChromeOS extension (kiosk-extension/) whether the wall screen should
// stay on. Sent as a window message on every change and once a minute, since
// the extension's worker may have restarted. Without the extension nobody
// listens and nothing happens. Renders nothing.
export function ScreenPower() {
  const auto = useAutoScreenOn();
  const wall = useScreenExtension();
  const hand = useOverride();
  const on = wall ? effectiveOn(auto, hand) : auto;

  useEffect(() => {
    if (hand && hand.auto !== auto) setScreenOverride(null);
    if (screenOnNow !== on) {
      screenOnNow = on;
      notify();
    }
  }, [auto, hand, on]);

  useDisplayEntity(wall, on, auto);
  useBatteryEntity(wall);

  useEffect(() => {
    document.documentElement.dataset.screen = on ? 'on' : 'off';
    const send = () => window.postMessage({ source: 'ha-dashboard', type: 'screen', on }, window.location.origin);
    send();
    const id = window.setInterval(send, 60_000);
    return () => window.clearInterval(id);
  }, [on]);

  // The extension answers each message (with the battery level from v1.1);
  // note once that it's there.
  useEffect(() => {
    const onReply = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'ha-dashboard-screen') return;
      const level: unknown = e.data.battery?.level;
      const nextLevel = typeof level === 'number' ? level : batteryLevel;
      if (extension && nextLevel === batteryLevel) return;
      if (!extension) console.info(`Screen power extension connected (wake ${e.data.canWake ? 'supported' : 'not supported'}).`);
      extension = true;
      batteryLevel = nextLevel;
      notify();
    };
    window.addEventListener('message', onReply);
    return () => window.removeEventListener('message', onReply);
  }, []);

  return null;
}

// Keeps SCREEN_POWER.entity (an input_boolean) in step with the wall screen,
// so HA has its history, and takes a toggle in HA as a command (rules in
// entityStep). Only on the wall screen: other devices never touch it.
function useDisplayEntity(wall: boolean, on: boolean, auto: boolean) {
  const hass = useHass();
  const entity = useEntity(wall && SCREEN_POWER.entity ? SCREEN_POWER.entity : undefined);
  const state = entity?.state;
  const prev = useRef<string>();
  const lastWrite = useRef<{ on: boolean; at: number }>();

  useEffect(() => {
    if (!wall || !SCREEN_POWER.entity) return;
    const step = entityStep({ prev: prev.current, state, on, lastWrite: lastWrite.current, nowMs: Date.now() });
    prev.current = state;
    if (step === 'command') setScreenOverride({ on: state === 'on', auto });
    if (step === 'write') {
      lastWrite.current = { on, at: Date.now() };
      hass.callService('input_boolean', on ? 'turn_on' : 'turn_off', {}, { entity_id: SCREEN_POWER.entity }).catch(() => {
        lastWrite.current = undefined;
      });
    }
  }, [wall, state, on, auto, hass]);
}

// Writes the wall screen's battery level into SCREEN_POWER.battery (an
// input_number), so an automation can switch its charger only when needed.
// The extension reports it with each answer, at least once a minute.
function useBatteryEntity(wall: boolean) {
  const hass = useHass();
  const level = useBatteryLevel();
  const entity = useEntity(wall && SCREEN_POWER.battery ? SCREEN_POWER.battery : undefined);
  const state = entity?.state;
  const lastWrite = useRef<{ value: number; at: number }>();

  useEffect(() => {
    if (!wall || !SCREEN_POWER.battery || state === undefined) return;
    const value = batteryToWrite(level, state, lastWrite.current, Date.now());
    if (value === undefined) return;
    lastWrite.current = { value, at: Date.now() };
    hass.callService('input_number', 'set_value', { value }, { entity_id: SCREEN_POWER.battery }).catch(() => {
      lastWrite.current = undefined;
    });
  }, [wall, level, state, hass]);
}
