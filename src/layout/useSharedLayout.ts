import { useCallback, useEffect, useState } from 'react';
import { useHass, useHassStatus } from '../ha/api';

// The arranged layout is shared by every device: it lives in HA (HassApi.fetchLayout),
// each device keeps a copy so reloads paint it at once, and open pages follow
// when any device saves it.

// Mock builds (the deployed preview) share the live dashboard's origin, so they
// keep their own copy and never touch the live dashboard's keys.
const MOCK = !!import.meta.env.VITE_MOCK;
const CACHE = MOCK ? 'mockCanvas' : 'dashCanvas';
// Before layouts were shared, each device kept one per layout and orientation.
const LEGACY_PREFIX = 'dashCanvas.';

function readCache(): unknown {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null');
  } catch {
    return null;
  }
}

function writeCache(data: unknown) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(data));
  } catch {
    // storage blocked: reloads wait for HA instead
  }
}

function legacyKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_PREFIX));
  } catch {
    return [];
  }
}

// This device's layout from before sharing, preferring the given layout's
// landscape one. Never in mock builds (they'd take the live dashboard's).
export function legacyLayout(name: string): string | null {
  if (MOCK) return null;
  const keys = legacyKeys();
  const pick = [`${LEGACY_PREFIX}${name}.landscape`, `${LEGACY_PREFIX}${name}.portrait`].find((k) => keys.includes(k)) ?? keys[0];
  try {
    return pick ? localStorage.getItem(pick) : null;
  } catch {
    return null;
  }
}

export function clearLegacy() {
  if (MOCK) return;
  try {
    legacyKeys().forEach((k) => localStorage.removeItem(k));
  } catch {
    // nothing to do
  }
}

export interface SharedLayout {
  // The stored layout: null = never saved, {} = reset to the columns.
  data: unknown;
  // HA has answered since the page loaded (until then `data` is this device's copy).
  known: boolean;
  save: (layout: object) => Promise<void>;
}

export function useSharedLayout(): SharedLayout {
  const hass = useHass();
  const { status } = useHassStatus();
  const [state, setState] = useState(() => ({ data: readCache(), known: false }));

  // Fetch on every (re)connect, and again whenever any device saves.
  useEffect(() => {
    if (status !== 'live') return;
    let alive = true;
    const load = () =>
      hass.fetchLayout().then(
        (data) => {
          if (!alive) return;
          writeCache(data);
          if (data !== null) clearLegacy(); // HA has it now: the old per-device copies are done with
          setState((s) => (s.known && JSON.stringify(s.data) === JSON.stringify(data) ? s : { data, known: true }));
        },
        () => undefined, // keep what we have
      );
    load();
    const unsub = hass.subscribeLayout(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [hass, status]);

  const save = useCallback(
    async (layout: object) => {
      writeCache(layout);
      setState({ data: layout, known: true });
      await hass.saveLayout(layout);
    },
    [hass],
  );

  return { ...state, save };
}
