import { useEffect, useRef } from 'react';
import { ALERTS, APPLIANCES, FRIDGE, ROOMS } from '../config/entities';
import { useHassStatus } from '../ha/api';
import { store, useEntities, useEntity } from '../ha/store';
import { num } from '../ha/format';
import { useNow } from '../hooks/useNow';
import { cycleEnded, overdueDoors } from '../lib/alerts';
import { useToasts } from './Toasts';

const DOORS = [...new Set([...ROOMS.flatMap((r) => r.doors), FRIDGE.door])];
const doorName = (id: string) => {
  if (id === FRIDGE.door) return 'Fridge door';
  if (id.includes('washing_machine')) return 'Washer door';
  if (id.includes('oven')) return 'Oven door';
  return `${ROOMS.find((r) => r.doors.includes(id))?.name ?? 'A'} door`;
};

// Watches for moments worth a banner: the washer or dishwasher finishing, and
// a door left open longer than ALERTS.doorOpenMinutes. Acts on live data only
// (never on the cached snapshot), so a reload doesn't replay old events.
export function Alerts() {
  const { push } = useToasts();
  const { status } = useHassStatus();
  const live = status === 'live';
  const now = useNow(30_000).getTime();

  const washer = useEntity(APPLIANCES.washer.running);
  const dwProgress = useEntity(APPLIANCES.dishwasher.progress);
  const washerRunning = washer?.state === 'on';
  const p = num(dwProgress);
  const dishRunning = p !== undefined && p > 0 && p < 100;

  const prev = useRef<{ washer?: boolean; dish?: boolean }>({});
  useEffect(() => {
    if (!live) return;
    const was = prev.current;
    if (cycleEnded(was.washer, washerRunning)) {
      push({ id: `washer-${Date.now()}`, title: 'Washer is done', text: 'Time to unload the laundry.', icon: 'washer' }, { chime: ALERTS.chime });
    }
    if (cycleEnded(was.dish, dishRunning)) {
      push({ id: `dish-${Date.now()}`, title: 'Dishwasher is done', text: 'The cycle has ended.', icon: 'dishwasher' }, { chime: ALERTS.chime });
    }
    prev.current = { washer: washerRunning, dish: dishRunning };
  }, [live, washerRunning, dishRunning, push]);

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
      push({ id: d.key, title: `${doorName(d.id)} open`, text: `Open for ${d.openMin} minutes.`, icon: 'doorOpen', tone: 'warn' }, { chime: ALERTS.chime });
    }
  }, [live, doors, now, push]);

  return null;
}
