// The house insights: fetches the last days of history for the home's devices,
// doors and plugs, runs lib/insights/, and keeps what the household has done with
// each finding (added the automation, not now, never) in a shared hidden
// dashboard so every screen agrees. The history is read when the card is on
// screen and again every half hour; the last answer is kept so a reload paints it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROOMS } from '../config/entities';
import { useHass, useHassStatus } from '../ha/api';
import { readCache, writeCache } from '../ha/useRegistry';
import { store } from '../ha/store';
import { useHomePower } from '../components/useHomePower';
import { automationId, buildInsights, type Device, type Insight } from '../lib/insights';
import { DAY } from '../lib/insights/stats';
import { useSaveStoreDoc, useStoreDoc } from '../money/useMoneyHistory';

const PREFIX = import.meta.env.VITE_MOCK ? 'mock' : 'dash';
const CACHE = `${PREFIX}Insights`;
const REFRESH_MS = 30 * 60_000;
// How many days of history are read (the recorder keeps about ten).
const HISTORY_HOURS = 24 * 10;
export const INSIGHTS_STORE = 'dashboard-insights';
// A dismissed finding comes back after this long, unless it was dismissed for good.
const SNOOZE_MS = 14 * DAY;

const friendly = (id: string) => (store.getAll()[id]?.attributes.friendly_name as string | undefined) ?? id.split('.')[1].replace(/_/g, ' ');

// The devices on the room cards (lights, fans, switches, geysers, the AC).
export function homeDevices(): Device[] {
  const out = new Map<string, Device>();
  for (const room of ROOMS) {
    for (const c of room.controls) {
      const domain = c.entity.split('.')[0];
      if (c.readOnly || !['light', 'fan', 'switch', 'climate'].includes(domain)) continue;
      out.set(c.entity, { entity: c.entity, name: c.name, kind: /geyser|boiler|water heater/i.test(c.name) ? 'geyser' : (domain as Device['kind']) });
    }
    if (room.quick) out.set(room.quick.entity, { entity: room.quick.entity, name: out.get(room.quick.entity)?.name ?? friendly(room.quick.entity), kind: room.quick.kind === 'geyser' ? 'geyser' : 'fan' });
  }
  return [...out.values()];
}

export function homeDoors(): { entity: string; name: string }[] {
  const seen = new Set<string>();
  return ROOMS.flatMap((r) => r.doors.map((entity) => ({ entity, name: friendly(entity).replace(/ (door sensor|door)$/i, '') + ' door' }))).filter((d) => !seen.has(d.entity) && seen.add(d.entity));
}

interface Loaded {
  insights: Insight[];
  at: number;
  // How many devices, doors and plugs were read.
  read: number;
}

interface Doc {
  version: 1;
  // Finding id → when it was dismissed, and whether for good.
  dismissed: Record<string, { at: number; forever?: boolean }>;
  // Suggestion id → the automation that was added from it.
  added: Record<string, { at: number; automation: string }>;
}

const parseDoc = (v: unknown): Doc => {
  const d = (v && typeof v === 'object' ? v : {}) as Partial<Doc>;
  return { version: 1, dismissed: d.dismissed && typeof d.dismissed === 'object' ? d.dismissed : {}, added: d.added && typeof d.added === 'object' ? d.added : {} };
};

export function useInsights() {
  const hass = useHass();
  const { status } = useHassStatus();
  const { consumers } = useHomePower();
  const [loaded, setLoaded] = useState<Loaded | undefined>(() => readCache<Loaded | undefined>(CACHE, undefined));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const doc = parseDoc(useStoreDoc(INSIGHTS_STORE, 'Insights'));
  const save = useSaveStoreDoc(INSIGHTS_STORE, 'Insights', 'House insights');
  const plugs = useRef(consumers);
  plugs.current = consumers;
  // Plugs are found a moment after load: read again once the list is known (and when it changes).
  const plugKey = consumers.map((c) => c.entity).join(',');

  useEffect(() => {
    if (status !== 'live') return;
    let alive = true;
    const run = async () => {
      try {
        const devices = homeDevices();
        const doors = homeDoors();
        const plugList = plugs.current.map((c) => ({ entity: c.entity, name: c.name }));
        const now = Date.now();
        const [history, stats, autos] = await Promise.all([
          hass.fetchStateHistory([...devices.map((d) => d.entity), ...doors.map((d) => d.entity)], HISTORY_HOURS),
          plugList.length ? hass.fetchStatistics(plugList.map((p) => p.entity), 35, 'day') : Promise.resolve({}),
          hass.fetchAutomationConfigs().catch(() => []),
        ]);
        if (!alive) return;
        const energy = plugList.map((p) => {
          const kw = store.getAll()[p.entity]?.attributes.unit_of_measurement === 'kW' ? 1000 : 1;
          const pts = (stats as Record<string, { start: number; mean?: number }[]>)[p.entity] ?? [];
          return { ...p, days: pts.filter((x) => x.mean !== undefined && x.start + DAY <= now).map((x) => ({ start: x.start, kwh: ((x.mean as number) * kw * 24) / 1000 })) };
        });
        const insights = buildInsights({ now, devices, doors, history, energy, automations: autos });
        const next = { insights, at: now, read: devices.length + doors.length + plugList.length };
        setLoaded(next);
        writeCache(CACHE, next);
        setError(undefined);
      } catch (e) {
        if (alive) setError(String((e as { message?: unknown })?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    const id = window.setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass, status, plugKey]);

  const now = Date.now();
  const visible = useMemo(
    () =>
      (loaded?.insights ?? []).filter((i) => {
        const d = doc.dismissed[i.id];
        return !d || (!d.forever && now - d.at > SNOOZE_MS);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, doc],
  );

  const dismiss = useCallback((i: Insight, forever = false) => save((cur) => ({ ...parseDoc(cur), dismissed: { ...parseDoc(cur).dismissed, [i.id]: { at: Date.now(), ...(forever ? { forever: true } : {}) } } })), [save]);

  // Adds the suggested automation in HA, and remembers it was added.
  const accept = useCallback(
    async (i: Insight) => {
      const s = i.suggestion;
      if (!s) return;
      const id = automationId(s, Date.now());
      await hass.createAutomation(id, s.draft);
      await save((cur) => ({ ...parseDoc(cur), added: { ...parseDoc(cur).added, [s.id]: { at: Date.now(), automation: id } } }));
    },
    [hass, save],
  );

  return { insights: visible, all: loaded?.insights ?? [], added: doc.added, read: loaded?.read ?? 0, at: loaded?.at, loading, error, dismiss, accept };
}
