import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { focusAnchors, type Anchor, type CarVisual, type Corner } from '../lib/carVisual';
import type { CarViewer } from './viewer';

export interface CarModelConfig {
  url: string;
  paint?: string;
  paintMaterial?: string;
  driverSide?: 'left' | 'right';
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const SEAT_NAME: Record<Corner, string> = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };

// The car modal's 3D stage. Shows `fallback` (the photo) until the model has
// loaded, then crossfades to it; on any failure (no WebGL, missing file) the
// photo simply stays. `visual` (lib/carVisual) drives doors, lamps, heaters and
// the callouts pinned to the car.
export function CarScene({ model, fallback, visual }: { model: CarModelConfig; fallback: ReactNode; visual?: CarVisual }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<CarViewer>();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [progress, setProgress] = useState(0);
  const [inside, setInside] = useState(false);

  useEffect(() => {
    let v: CarViewer | undefined;
    let alive = true;
    let ro: ResizeObserver | undefined;
    const onVisibility = () => (document.hidden ? v?.stop() : v?.start());
    (async () => {
      try {
        const { CarViewer } = await import('./viewer');
        if (!alive || !canvas.current) return;
        v = new CarViewer(canvas.current, { ...model, reducedMotion: reducedMotion(), onProgress: (f) => alive && setProgress(f) });
        const fit = () => {
          const r = wrap.current?.getBoundingClientRect();
          if (r) v?.resize(r.width, r.height);
        };
        fit();
        ro = new ResizeObserver(fit);
        if (wrap.current) ro.observe(wrap.current);
        await v.load();
        if (!alive) return;
        fit();
        v.start();
        document.addEventListener('visibilitychange', onVisibility);
        // Mock builds: poke the viewer from the console (paint, doors, camera).
        if (import.meta.env.VITE_MOCK) (window as unknown as { __carViewer?: CarViewer }).__carViewer = v;
        setViewer(v);
        setState('ready');
      } catch (e) {
        console.warn('3D car unavailable, showing the photo', e);
        if (alive) setState('failed');
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      v?.dispose();
    };
  }, [model.url, model.paint, model.paintMaterial, model.driverSide]);

  useEffect(() => {
    if (!viewer || !visual) return;
    viewer.setVisual(visual);
    viewer.setFocus(focusAnchors(visual.callouts));
  }, [viewer, visual]);

  const toggleInside = () => {
    if (!viewer) return;
    viewer.setInside(!inside);
    setInside(!inside);
  };

  return (
    <div className={`car-stage-view ${state} ${inside ? 'inside' : ''}`} ref={wrap}>
      <div className="car-stage-photo" aria-hidden={state === 'ready'}>{fallback}</div>
      {state !== 'failed' && <canvas ref={canvas} className="car-stage-canvas" aria-label="3D model of the car; drag to look around" />}
      {state === 'loading' && progress > 0 && progress < 1 && (
        <div className="car-stage-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      )}
      {state === 'ready' && viewer && (
        <>
          {visual && <Callouts viewer={viewer} visual={visual} />}
          {inside && visual && <CabinChips visual={visual} />}
          <button className={`car-stage-btn ${inside ? 'active' : ''}`} onClick={toggleInside} aria-pressed={inside}>
            <Icon name={inside ? 'car' : 'seat'} size={18} />
            {inside ? 'Outside' : 'Inside'}
          </button>
        </>
      )}
    </div>
  );
}

// Labels pinned to parts of the car. React renders them once per state change;
// the viewer moves them every frame (no React work per frame).
function Callouts({ viewer, visual }: { viewer: CarViewer; visual: CarVisual }) {
  const groups = new Map<Anchor, CarVisual['callouts']>();
  for (const c of visual.callouts) groups.set(c.anchor, [...(groups.get(c.anchor) ?? []), c]);
  const refs = useRef(new Map<Anchor, HTMLDivElement>());

  useEffect(() => {
    const place = () => {
      for (const [anchor, el] of refs.current) {
        const p = viewer.project(anchor);
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        el.classList.toggle('hidden', !p.visible);
        // Labels go right of the dot, or left of it near the right edge.
        el.classList.toggle('flip', p.x > (el.parentElement?.clientWidth ?? 0) * 0.62);
      }
    };
    place();
    viewer.invalidate();
    return viewer.onFrame(place);
  }, [viewer, visual]);

  return (
    <div className="car-callouts" aria-live="polite">
      {[...groups.entries()].map(([anchor, items]) => (
        <div
          key={anchor}
          className={`car-callout hidden ${items.some((c) => c.tone === 'warn') ? 'warn' : 'info'}`}
          ref={(el) => {
            if (el) refs.current.set(anchor, el);
            else refs.current.delete(anchor);
          }}
        >
          <i className="car-callout-dot" />
          <div className="car-callout-body">
            {items.map((c) => (
              <span key={c.id} className={`car-callout-chip ${c.tone}`}>
                <Icon name={c.icon} size={14} /> {c.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Inside the cabin: what's warming or cooling it.
function CabinChips({ visual }: { visual: CarVisual }) {
  const chips: { key: string; icon: IconName; label: string; tone: 'heat' | 'cool' }[] = [];
  for (const [corner, level] of Object.entries(visual.seatHeat) as [Corner, string][]) {
    chips.push({ key: corner, icon: 'seatHeater', label: `${SEAT_NAME[corner]} seat · ${level}`, tone: 'heat' });
  }
  if (visual.steeringHeat) chips.push({ key: 'wheel', icon: 'steering', label: 'Steering wheel heat', tone: 'heat' });
  if (visual.defrostFront) chips.push({ key: 'df', icon: 'defrostFront', label: 'Windscreen defrost', tone: 'heat' });
  if (visual.defrostRear) chips.push({ key: 'dr', icon: 'defrostRear', label: 'Rear window heater', tone: 'heat' });
  const ac = visual.callouts.find((c) => c.id === 'ac');
  if (ac) chips.push({ key: 'ac', icon: 'ac', label: ac.label, tone: 'cool' });
  return (
    <div className="car-cabin-chips">
      {chips.length ? (
        chips.map((c) => (
          <span key={c.key} className={`car-callout-chip ${c.tone}`}>
            <Icon name={c.icon} size={14} /> {c.label}
          </span>
        ))
      ) : (
        <span className="car-callout-chip">Heaters and climate off · drag to look around</span>
      )}
    </div>
  );
}
