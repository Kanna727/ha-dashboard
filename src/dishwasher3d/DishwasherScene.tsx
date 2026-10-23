import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { DishState, DishwasherViewer } from './viewer';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// The dishwasher modal's 3D stage (viewer.ts, loaded on demand). Hidden if
// WebGL isn't available. "Look inside" opens the door, or mid-cycle shows the
// cutaway with the spray arms running.
export function DishwasherScene({ state, className = '' }: { state: DishState; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<DishwasherViewer>();
  const [failed, setFailed] = useState(false);
  const [inside, setInside] = useState(false);

  useEffect(() => {
    let v: DishwasherViewer | undefined;
    let alive = true;
    let ro: ResizeObserver | undefined;
    const onVisibility = () => !document.hidden && v?.wake();
    (async () => {
      try {
        const { DishwasherViewer } = await import('./viewer');
        if (!alive || !canvas.current || !wrap.current) return;
        v = new DishwasherViewer(canvas.current);
        const el = wrap.current;
        const fit = () => v?.resize(el.clientWidth, el.clientHeight);
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(el);
        document.addEventListener('visibilitychange', onVisibility);
        // Mock builds: poke the viewer from the console.
        if (import.meta.env.VITE_MOCK) (window as unknown as { __dishViewer?: DishwasherViewer }).__dishViewer = v;
        setViewer(v);
      } catch (e) {
        console.warn('3D dishwasher unavailable', e);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      v?.dispose();
    };
  }, []);

  useEffect(() => {
    viewer?.setState(state);
  }, [viewer, state]);

  if (failed) return null;
  const running = ['run', 'pause', 'delayedstart'].includes(state.op ?? '');
  const doorOpen = state.door === 'open';
  const toggle = () => {
    viewer?.setInside(!inside);
    setInside(!inside);
  };

  return (
    <div className={`dw-stage ${className} ${reducedMotion() ? 'still' : ''}`} ref={wrap}>
      <canvas ref={canvas} aria-label="3D model of the dishwasher; drag to look around" />
      {viewer && !doorOpen && (
        <button className="car-stage-btn" onClick={toggle} aria-pressed={inside}>
          <Icon name={inside ? 'close' : 'dishwasher'} size={18} />
          {inside ? (running ? 'Close cutaway' : 'Close door') : 'Look inside'}
        </button>
      )}
      {doorOpen && <span className="dw-stage-note">Door open</span>}
    </div>
  );
}
