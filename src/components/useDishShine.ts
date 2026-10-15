import { useEffect, useState } from 'react';
import { APPLIANCES } from '../config/entities';
import { useEntity } from '../ha/store';
import { num } from '../ha/format';
import { finishedAt, shineEnds } from '../lib/dishes';

const KEY = 'dishwasherDoneAt';

function readStored(): number | undefined {
  try {
    return Number(localStorage.getItem(KEY)) || undefined;
  } catch {
    return undefined;
  }
}

// True for a few minutes after the dishwasher finishes (see lib/dishes.ts).
// HA only reports the finish for about a minute, so the time is kept here and
// in localStorage, which lets the shine survive a kiosk reload. Re-renders
// itself when the shine ends; no ticking clock otherwise.
export function useDishShine(enabled: boolean, running: boolean): boolean {
  const op = useEntity(enabled ? APPLIANCES.dishwasher.state : undefined);
  const progress = useEntity(enabled ? APPLIANCES.dishwasher.progress : undefined);
  const seen = finishedAt(op?.state, op?.last_changed, num(progress), progress?.last_changed);
  const [stored, setStored] = useState(readStored);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (seen === undefined || seen === stored) return;
    setStored(seen);
    try {
      localStorage.setItem(KEY, String(seen));
    } catch {
      // Private mode or blocked storage: the shine just won't survive a reload.
    }
  }, [seen, stored]);

  const end = enabled ? shineEnds(seen ?? stored, Date.now(), running) : undefined;
  useEffect(() => {
    if (end === undefined) return;
    const id = window.setTimeout(() => rerender((n) => n + 1), end - Date.now() + 250);
    return () => window.clearTimeout(id);
  }, [end]);
  return end !== undefined;
}
