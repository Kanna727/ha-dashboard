import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { ALERTS, DOORBELL } from '../config/entities';
import { useHass, useHassStatus } from '../ha/api';
import type { CameraState } from '../ha/cameraStream';
import { store, useEntity } from '../ha/store';
import { chime } from '../lib/chime';
import { findDoorbell, isPress } from '../lib/doorbell';
import { Icon } from './Icon';

// As one string, so the store hook only re-renders when the entities change.
let memo: { states: HassEntities; sig: string } | null = null;
function signature(states: HassEntities): string {
  if (memo?.states === states) return memo.sig;
  const { camera, press } = findDoorbell(states, DOORBELL);
  memo = { states, sig: `${camera ?? ''}|${press ?? ''}` };
  return memo.sig;
}

// Whether the doorbell screen is up. ScreenPower keeps the wall screen on (and
// wakes it) meanwhile.
let ringing = false;
const listeners = new Set<() => void>();
const subscribeRinging = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useDoorbellRinging = () => useSyncExternalStore(subscribeRinging, () => ringing);

// ?doorbellTest (any build): rings on load, to check a screen's camera without going to the door.
const TEST = new URLSearchParams(window.location.search).has('doorbellTest');

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Someone pressing the doorbell brings the camera's live view up full screen,
// over everything, on every open dashboard. Another press keeps it up for
// longer. Watches live data only, so a reload doesn't replay a press.
export function Doorbell() {
  const sig = useSyncExternalStore(store.subscribe, () => signature(store.getAll()));
  const [camera, press] = sig.split('|');
  const pressed = useEntity(press || undefined)?.state;
  const live = useHassStatus().status === 'live';
  const [ringAt, setRingAt] = useState<number | null>(null);

  const was = useRef(pressed);
  useEffect(() => {
    const before = was.current;
    was.current = pressed;
    if (!live || !camera || !isPress(before, pressed)) return;
    setRingAt(Date.now());
    if (ALERTS.chime) chime();
  }, [live, camera, pressed]);

  useEffect(() => {
    if (TEST && live && camera) setRingAt(Date.now());
  }, [live, camera]);

  const up = ringAt !== null;
  useEffect(() => {
    ringing = up;
    listeners.forEach((l) => l());
  }, [up]);

  const close = useCallback(() => setRingAt(null), []);
  if (ringAt === null) return null;
  return <DoorbellScreen camera={camera} ringAt={ringAt} onClose={close} />;
}

function DoorbellScreen({ camera, ringAt, onClose }: { camera: string; ringAt: number; onClose: () => void }) {
  const hass = useHass();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState | 'connecting'>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [sound, setSound] = useState(false);
  const seconds = DOORBELL.seconds;

  useEffect(() => {
    if (!video.current) return;
    setState('connecting');
    return hass.playCamera(camera, video.current, setState);
  }, [hass, camera, attempt]);

  useEffect(() => {
    const timer = window.setTimeout(onClose, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [ringAt, seconds, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="doorbell-screen" role="alertdialog" aria-live="assertive" aria-label="Someone's at the door" style={{ '--life': `${seconds}s` } as CSSProperties}>
      {/* Sound can't start by itself, and not everyone wants the street in the room. */}
      <video ref={video} className={state === 'playing' ? 'on' : undefined} autoPlay muted={!sound} playsInline />
      {state !== 'playing' && (
        <div className="doorbell-status">
          {state === 'connecting' ? (
            <>
              <span className="doorbell-spinner" />
              <p>Connecting to the camera…</p>
            </>
          ) : (
            <>
              <p>The camera isn't responding.</p>
              <button className="chip-btn" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </>
          )}
        </div>
      )}
      <header className="doorbell-head">
        <span className="doorbell-badge">
          <Icon name="doorbell" size={30} />
        </span>
        <div className="doorbell-titles">
          <h2>Someone's at the door</h2>
          <p>Rang at {clock(ringAt)}</p>
        </div>
        <button className="round" onClick={() => setSound(!sound)} aria-label={sound ? 'Mute' : 'Listen'} aria-pressed={sound}>
          <Icon name={sound ? 'volumeOn' : 'volumeOff'} size={26} />
        </button>
        <button className="round" onClick={onClose} aria-label="Close">
          <Icon name="close" size={26} />
        </button>
      </header>
      <span key={ringAt} className="alert-life" />
    </div>
  );
}
