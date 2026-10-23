import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HassEntities } from 'home-assistant-js-websocket';
import { DESK } from '../config/entities';
import { useHass, useHassStatus, type HistoryPoint } from '../ha/api';
import { loadRegistry, REGISTRY_REFRESH_MS } from '../ha/registry';
import { store, useEntities } from '../ha/store';
import { num } from '../ha/format';
import { deskBase, deskIds, motion, standLine, type DeskIds } from '../lib/desk';

// The standing desk: its entities (config, else the first number.*_desk_height,
// plus everything sharing its name prefix or device), its live height and
// movement, the heights its preset keys go to (learned), and its history.

const objectId = (id: string) => id.slice(id.indexOf('.') + 1);

// The desk's entity IDs as one string, so the store hook only re-renders when
// the set of entities changes, not on every state update.
let memo: { states: HassEntities; sig: string } | null = null;
function signature(states: HassEntities): string {
  if (memo?.states === states) return memo.sig;
  const ids = Object.keys(states);
  const anchor =
    (DESK.entity && states[DESK.entity] ? DESK.entity : undefined) ??
    ids.filter((e) => /^number\..+_desk_height$/.test(e)).sort()[0] ??
    ids.filter((e) => /^cover\..+_desk$/.test(e)).sort()[0] ??
    '';
  const base = anchor ? deskBase(anchor) : '';
  const sig = anchor ? [anchor, ...ids.filter((id) => id !== anchor && objectId(id).startsWith(`${base}_`)).sort()].join(',') : '';
  memo = { states, sig };
  return sig;
}

export function useDeskIds(): DeskIds | null {
  const hass = useHass();
  const sig = useSyncExternalStore(store.subscribe, () => signature(store.getAll()));
  const [device, setDevice] = useState<string[]>([]);
  const [config, setConfig] = useState<string[]>([]);
  const anchor = sig.split(',')[0];

  // Entities on the desk's device that don't share its name prefix (renamed in
  // HA), and which of its entities are configuration (calibration settings).
  useEffect(() => {
    if (!anchor) return;
    let alive = true;
    const load = () =>
      loadRegistry(hass)
        .then((r) => {
          if (!alive) return;
          const dev = r.entities.find((e) => e.entityId === anchor)?.deviceId;
          const mine = dev ? r.entities.filter((e) => e.deviceId === dev) : [];
          const more = mine.map((e) => e.entityId).sort();
          const cfg = mine.filter((e) => e.category === 'config').map((e) => e.entityId).sort();
          setDevice((prev) => (prev.join() === more.join() ? prev : more));
          setConfig((prev) => (prev.join() === cfg.join() ? prev : cfg));
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, anchor]);

  return useMemo(() => {
    if (!sig) return null;
    const [first, ...rest] = sig.split(',');
    const live = store.getAll();
    // Disabled registry entities have no state; leave them out.
    return deskIds(first, rest, device.filter((id) => live[id]), config);
  }, [sig, device, config]);
}

export interface DeskLive {
  height?: number; // cm
  min: number;
  max: number;
  step: number;
  moving?: 'up' | 'down';
  idle?: number; // seconds since the height last changed (the controller's idle counter)
  offline: boolean;
}

export function useDeskLive(ids: DeskIds | null): DeskLive {
  const [sensor, number, cover, status, minE, maxE, idle] = useEntities(
    ids ? [ids.height ?? '', ids.setHeight ?? '', ids.cover ?? '', ids.status ?? '', ids.minHeight ?? '', ids.maxHeight ?? '', ids.idleTime ?? ''] : [],
  );
  const a = number?.attributes ?? {};
  const height = num(sensor) ?? num(number);
  const offline = !ids || (height === undefined && [cover, status].every((e) => !e || e.state === 'unavailable'));
  // The range: the controller's Min/Max Height settings when it has them (its
  // height number's own limits can be much wider), else the number's.
  const min = num(minE) ?? (a.min as number | undefined) ?? 60;
  const max = num(maxE) ?? (a.max as number | undefined) ?? 130;
  return {
    height,
    min,
    max: max > min ? max : min + 1,
    step: (a.step as number | undefined) ?? 0.1,
    moving: motion(status?.state) ?? motion(cover?.state),
    idle: num(idle),
    offline,
  };
}

/* ---------- preset heights ---------- */

// Where each memory key goes: the controller's M1–M4 height sensors when it has
// them, else learned: after a key is pressed (from here, or from HA: a button's
// state is the time it was last pressed), wherever the desk comes to rest is
// that key's height, and saving one ("Set Desk M…", pressed anywhere) records
// the current height. Learned heights are kept per device in localStorage.
const PRESETS_KEY = 'deskPresets';
const SETTLE_MS = 2500; // still this long = arrived
const NO_MOVE_MS = 6000; // never moved: it was already there

function readPresets(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

const presetListeners = new Set<() => void>();
let presetCache: Record<string, number> | null = null;
function presetSnapshot() {
  return (presetCache ??= readPresets());
}
function writePreset(key: string, cm: number) {
  presetCache = { ...presetSnapshot(), [key]: Math.round(cm * 10) / 10 };
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presetCache));
  } catch {
    // storage blocked: kept for this page only
  }
  presetListeners.forEach((l) => l());
}
const subscribePresets = (l: () => void) => {
  presetListeners.add(l);
  return () => presetListeners.delete(l);
};

export function usePresetHeights(ids: DeskIds | null, live: DeskLive) {
  const hass = useHass();
  const { status } = useHassStatus();
  const learned = useSyncExternalStore(subscribePresets, presetSnapshot);
  const presets = ids?.presets ?? [];
  const buttons = useEntities(presets.map((p) => p.id));
  const setButtons = useEntities(presets.map((p) => p.set ?? ''));
  const reported = useEntities(presets.map((p) => p.heightSensor ?? ''));
  const heights = useMemo(() => {
    const out = { ...learned };
    presets.forEach((p, i) => {
      const v = num(reported[i]);
      if (v !== undefined) out[p.key] = v;
    });
    return out;
  }, [learned, presets, reported]);
  const pending = useRef<{ key: string; at: number; moved: boolean } | null>(null);
  const seen = useRef<Record<string, string>>({});
  const skip = useRef<Record<string, number>>({}); // presses made by "save", not moves
  const [tick, setTick] = useState(0);

  // A preset key pressed anywhere (a fresh timestamp on its button).
  useEffect(() => {
    if (!ids) return;
    ids.presets.forEach((p, i) => {
      const s = buttons[i]?.state;
      const before = seen.current[p.id];
      seen.current[p.id] = s ?? '';
      if (status !== 'live' || before === undefined || !s || s === before) return;
      const t = Date.parse(s);
      if (!Number.isFinite(t) || Date.now() - t > 60_000) return;
      if ((skip.current[p.key] ?? 0) > Date.now()) return;
      pending.current = { key: p.key, at: Date.now(), moved: false };
      setTick((n) => n + 1);
    });
  }, [ids, buttons, status]);

  // A key saved anywhere: it now goes to the current height.
  useEffect(() => {
    if (!ids) return;
    ids.presets.forEach((p, i) => {
      if (!p.set) return;
      const s = setButtons[i]?.state;
      const before = seen.current[p.set];
      seen.current[p.set] = s ?? '';
      if (status !== 'live' || before === undefined || !s || s === before) return;
      const t = Date.parse(s);
      if (Number.isFinite(t) && Date.now() - t < 60_000 && live.height !== undefined) writePreset(p.key, live.height);
    });
  }, [ids, setButtons, status, live.height]);

  // When the desk comes to rest, that's where the key goes.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (live.moving) {
      p.moved = true;
      return;
    }
    const t = window.setTimeout(
      () => {
        if (pending.current !== p || live.height === undefined) return;
        pending.current = null;
        writePreset(p.key, live.height);
      },
      p.moved ? SETTLE_MS : Math.max(0, p.at + NO_MOVE_MS - Date.now()),
    );
    return () => window.clearTimeout(t);
  }, [live.moving, live.height, tick]);

  // Go to a preset.
  const go = useCallback(
    (key: string) => {
      const p = ids?.presets.find((x) => x.key === key);
      if (!p) return;
      pending.current = { key, at: Date.now(), moved: false };
      skip.current[key] = Date.now() + 1500; // the button's own state change is this press
      setTick((n) => n + 1);
      hass.callService('button', 'press', {}, { entity_id: p.id });
    },
    [hass, ids],
  );

  // Save the current height to a key (the controller's "Set Desk M…" button).
  const save = useCallback(
    (key: string) => {
      const p = ids?.presets.find((x) => x.key === key);
      if (!p?.set) return;
      pending.current = null;
      hass.callService('button', 'press', {}, { entity_id: p.set });
      if (live.height !== undefined) writePreset(key, live.height);
    },
    [hass, ids, live.height],
  );

  const line = standLine(presets, heights, DESK.standAbove);
  return { heights, go, save, line };
}

/* ---------- history ---------- */

// The height over the last week (the recorder keeps ~10 days), refreshed every
// 5 minutes, with the live reading appended so today's numbers keep up.
export function useDeskHistory(id: string | undefined, current: number | undefined, days = 7): HistoryPoint[] | null {
  const hass = useHass();
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      hass
        .fetchHistory([id], days * 24)
        .then((r) => alive && setPoints(r[id] ?? []))
        .catch(() => alive && setPoints((p) => p ?? []));
    load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hass, id, days]);
  return useMemo(() => {
    if (!points) return null;
    const last = points[points.length - 1];
    return current !== undefined && (!last || Math.abs(last.v - current) >= 0.1) ? [...points, { t: Date.now(), v: current }] : points;
  }, [points, current]);
}
