import type { HassEntities } from 'home-assistant-js-websocket';
import { store } from './store';

// Last known entity states, so a reload (kiosk self-update, reconnect,
// cold start) paints the full dashboard immediately instead of a blank
// "Connecting…" screen, then quietly swaps in live data.
const KEY = 'dashSnapshot';
const SAVE_EVERY_MS = 20_000;
const MAX_AGE_MS = 24 * 3600_000;

export function loadSnapshot(): HassEntities | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { at, states } = JSON.parse(raw) as { at: number; states: HassEntities };
    if (!states || Date.now() - at > MAX_AGE_MS) return null;
    return states;
  } catch {
    return null;
  }
}

// A phone's latest notification can be a private message or a one-time code.
const PRIVATE = /_last(_removed)?_notification$/;

export function saveSnapshotNow() {
  const all = store.getAll();
  if (!Object.keys(all).length) return;
  const states = Object.fromEntries(Object.entries(all).filter(([id]) => !PRIVATE.test(id)));
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), states }));
  } catch {
    // Quota or private mode: the cache is a nicety, not a requirement.
  }
}

let started = false;

// Throttled persistence, plus a final save when the page is hidden or about
// to unload (the self-update reload triggers `pagehide`).
export function persistSnapshots() {
  if (started) return;
  started = true;
  let dirty = false;
  store.subscribe(() => {
    dirty = true;
  });
  window.setInterval(() => {
    if (dirty) {
      dirty = false;
      saveSnapshotNow();
    }
  }, SAVE_EVERY_MS);
  window.addEventListener('pagehide', saveSnapshotNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveSnapshotNow());
}
