import { useEffect, useRef } from 'react';
import { VACUUM } from '../config/entities';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { showOnClean } from '../layout/CleanPage';
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
    // The rules call the Clean page "vacuum" (it was the vacuum's own page before the tabs).
    const r = autoOpenStep(s.current, { state, page: page === 'clean' ? 'vacuum' : page, idleMs: t - lastInput.current, busy: busy(), now: t });
    s.current = r.next;
    if (r.go === 'vacuum') showOnClean('vacuum');
    if (r.go) go(r.go === 'vacuum' ? 'clean' : 'home');
  }, [on, state, page, now, go]);
}
