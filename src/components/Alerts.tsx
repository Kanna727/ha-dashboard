import { useEffect, useRef } from 'react';
import { ALERTS, APPLIANCES, FRIDGE, ROOMS } from '../config/entities';
import { useHass, useHassStatus } from '../ha/api';
import { store, useEntities, useEntity } from '../ha/store';
import { num } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { cycleEnded, mirrorsService, noticeFrom, overdueDoors } from '../lib/alerts';
import { useToasts } from './Toasts';

const DOORS = [...new Set([...ROOMS.flatMap((r) => r.doors), FRIDGE.door])];
const WASHER_DOOR = DOORS.find((id) => id.includes('washing_machine'));
const doorName = (id: string) => {
  if (id === FRIDGE.door) return 'Fridge door';
  if (id.includes('washing_machine')) return 'Washer door';
  if (id.includes('oven')) return 'Oven door';
  return `${ROOMS.find((r) => r.doors.includes(id))?.name ?? 'A'} door`;
};

// One automation often sends the same message to each phone in turn
// (notify.mobile_app_a, then _b): show it once.
const SAME_NOTICE_MS = 10_000;

// Watches for moments worth a full-screen alert: the washer or dishwasher
// finishing, a door left open longer than ALERTS.doorOpenMinutes, and every
// message HA's automations send to the phones (notify services matching
// ALERTS.notify; an alarm when sent as one or matching ALERTS.alarms). Acts on live data only (never on the cached snapshot), so a
// reload doesn't replay old events.
export function Alerts() {
  const hass = useHass();
  const { push } = useToasts();
  const { status } = useHassStatus();
  const live = status === 'live';
  const now = useNow(30_000).getTime();
  const seconds = ALERTS.seconds;

  // Mirrored HA notifications. While they flow, HA already announces the
  // washer and dishwasher finishing, so the built-in "done" alerts stand down.
  const mirroring = useRef(false);
  useEffect(() => {
    if (!ALERTS.notify.length) return;
    const recent = new Map<string, number>();
    let n = 0;
    return hass.subscribeNotifyCalls(
      (service, data) => {
        if (!mirrorsService(service, ALERTS.notify)) return;
        const notice = noticeFrom(data, ALERTS.alarms);
        if (!notice) return;
        const key = `${notice.title}|${notice.text ?? ''}`;
        const t = Date.now();
        if (t - (recent.get(key) ?? 0) < SAME_NOTICE_MS) return;
        recent.set(key, t);
        push({ id: `ha-${t}-${n++}`, icon: notice.tone === 'alarm' ? 'siren' : 'bell', source: 'Home Assistant', full: true, seconds, ...notice }, { chime: ALERTS.chime });
      },
      (ok) => {
        mirroring.current = ok;
      },
    );
  }, [hass, push, seconds]);

  const washer = useEntity(APPLIANCES.washer.running);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const washerRunning = washer?.state === 'on';
  const p = num(dwProgress);
  const dishRunning = p !== undefined && p > 0 && p < 100;
  // A stopped cycle also drops the progress: Home Connect then reports
  // aborting / ready rather than finished, and that isn't "done".
  const dwOp = useEntity(APPLIANCES.dishwasher.state)?.state;
  const aborted = useRef(false);
  if (dwOp === 'aborting') aborted.current = true;

  const prev = useRef<{ washer?: boolean; dish?: boolean }>({});
  useEffect(() => {
    if (!live) return;
    const was = prev.current;
    prev.current = { washer: washerRunning, dish: dishRunning };
    const stopped = aborted.current || dwOp === 'ready' || dwOp === 'inactive';
    if (!dishRunning) aborted.current = false;
    if (mirroring.current) return;
    if (cycleEnded(was.washer, washerRunning)) {
      // Gone once the washer door opens (someone is unloading).
      const dismissWhen = WASHER_DOOR ? { entities: [WASHER_DOOR], states: ['on'] } : undefined;
      push({ id: `washer-${Date.now()}`, title: 'Washer is done', text: 'Time to unload the laundry.', icon: 'washer', full: true, seconds, dismissWhen }, { chime: ALERTS.chime });
    }
    if (cycleEnded(was.dish, dishRunning) && !stopped) {
      push({ id: `dish-${Date.now()}`, title: 'Dishwasher is done', text: 'The cycle has ended.', icon: 'dishwasher', full: true, seconds }, { chime: ALERTS.chime });
    }
  }, [live, washerRunning, dishRunning, dwOp, push, seconds]);

  const doors = useEntities(DOORS);
  const alerted = useRef(new Set<string>());
  useEffect(() => {
    if (!live) return;
    const readings = DOORS.map((id, i) => ({
      id,
      open: doors[i]?.state === 'on',
      since: Date.parse(doors[i]?.last_changed ?? store.getAll()[id]?.last_changed ?? ''),
    }));
    for (const d of overdueDoors(readings, now, ALERTS.doorOpenMinutes, alerted.current)) {
      alerted.current.add(d.key);
      push(
        {
          id: d.key,
          title: `${doorName(d.id)} open`,
          text: `Open for ${d.openMin} minutes.`,
          icon: 'doorOpen',
          tone: 'warn',
          full: true,
          seconds,
          dismissWhen: { entities: [d.id], states: ['off'] }, // gone as soon as it closes
        },
        { chime: ALERTS.chime },
      );
    }
  }, [live, doors, now, push, seconds]);

  return null;
}
