import { useEffect, useRef } from 'react';
import { VACUUM } from '../config/entities';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { usePage } from '../layout/pages';
import { AUTO_OPEN_START, autoOpenStep } from '../lib/vacuum';
import { useVacuumId } from './useVacuum';

// The owner asked for the vacuum page to open by itself whenever the robot runs
// (rules in lib/vacuum.ts, autoOpenStep). VACUUM.autoOpen: false turns it off.
const busy = () => !!document.querySelector('.modal-backdrop, .sheet-backdrop, .cols.canvas.editing');

export function useVacuumAutoOpen() {
  const id = useVacuumId();
  const vac = useEntity(id || undefined);
  const [page, go] = usePage();
  const lastInput = useRef(Date.now());
  const s = useRef(AUTO_OPEN_START);
  const on = !!id && VACUUM.autoOpen !== false;
  const now = useNow(on ? 5000 : 3_600_000);

  useEffect(() => {
    const mark = () => {
      lastInput.current = Date.now();
    };
    const opts = { capture: true, passive: true } as const;
    ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.addEventListener(t, mark, opts));
    return () => ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.removeEventListener(t, mark, opts));
  }, []);

  const state = vac?.state;
  useEffect(() => {
    if (!on) return;
    const t = Date.now(); // `now` only re-runs this every 5 s
    const r = autoOpenStep(s.current, { state, page, idleMs: t - lastInput.current, busy: busy(), now: t });
    s.current = r.next;
    if (r.go) go(r.go);
  }, [on, state, page, now, go]);
}
