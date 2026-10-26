import { useEffect, useRef } from 'react';
import { HOME_IDLE } from '../config/entities';
import { useModal } from '../components/Modal';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { idleHomeStep } from '../lib/idleHome';
import { isRunning } from '../lib/vacuum';
import { useVacuumId } from '../vacuum/useVacuum';
import { usePage } from './pages';

// After HOME_IDLE.minutes without a touch, key or wheel (default 2, wall
// tablet only), close a popup left open and go back to the Home page, the
// glance page (rules in lib/idleHome.ts). Checked every 10 s (every second with
// ?homeIdleTest, which also cuts the wait to 15 s on any layout). Renders nothing.
const TEST = new URLSearchParams(window.location.search).has('homeIdleTest');
const MINUTES = TEST ? 0.25 : HOME_IDLE.minutes;

export function IdleHome({ layout }: { layout: string }) {
  const on = MINUTES > 0 && (TEST || HOME_IDLE.layouts.includes(layout));
  const [page, go] = usePage();
  const modal = useModal();
  const vac = useEntity(useVacuumId() || undefined);
  const lastInput = useRef(Date.now());
  const now = useNow(!on ? 3_600_000 : TEST ? 1000 : 10_000);

  useEffect(() => {
    const mark = () => {
      lastInput.current = Date.now();
    };
    const opts = { capture: true, passive: true } as const;
    ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.addEventListener(t, mark, opts));
    return () => ['pointerdown', 'keydown', 'wheel'].forEach((t) => window.removeEventListener(t, mark, opts));
  }, []);

  useEffect(() => {
    if (!on) return;
    const step = idleHomeStep({
      page,
      idleMs: Date.now() - lastInput.current,
      minutes: MINUTES,
      modalOpen: !!document.querySelector('.modal-backdrop'),
      busy: !!document.querySelector('.sheet-backdrop, .cols.canvas.editing'),
      vacuumRunning: isRunning(vac?.state) || vac?.state === 'paused',
    });
    if (step.close) modal.close();
    if (step.home) go('home');
  }, [on, now, page, vac?.state, modal, go]);

  return null;
}
