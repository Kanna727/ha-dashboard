import { useEffect, useMemo } from 'react';
import { LAYOUT_DASHBOARD } from '../config/load';
import { useDocStatus, useSaveStoreDoc, useStoreDoc } from '../storage';

// The arranged layout is shared by every device: it lives in HA (the hidden
// LAYOUT_DASHBOARD, kept through storage/), each device keeps a copy so reloads
// paint it at once, and open pages follow when any device saves it. A save is
// "change this page's boxes in the stored layout", so two devices arranging
// different pages don't undo each other.

// Mock builds (the deployed preview) share the live dashboard's origin, so they
// keep their own copy and never touch the live dashboard's keys.
const MOCK = !!import.meta.env.VITE_MOCK;
// Before layouts were shared, each device kept one per layout and orientation.
const LEGACY_PREFIX = 'dashCanvas.';

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
  // Applies `change` to the layout as stored right now and saves the result.
  save: (change: (current: unknown) => object) => Promise<void>;
}

export function useSharedLayout(): SharedLayout {
  const data = useStoreDoc(LAYOUT_DASHBOARD, 'Canvas', { title: 'Dashboard layout' });
  const { loaded } = useDocStatus(LAYOUT_DASHBOARD, 'Canvas');
  const save = useSaveStoreDoc(LAYOUT_DASHBOARD, 'Canvas', 'Dashboard layout');

  // HA has it now: the old per-device copies are done with.
  useEffect(() => {
    if (loaded && data !== null) clearLegacy();
  }, [loaded, data]);

  return useMemo(() => ({ data, known: loaded, save }), [data, loaded, save]);
}
