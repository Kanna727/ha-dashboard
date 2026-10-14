import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import type { CarViewer } from './viewer';

export interface CarModelConfig {
  url: string;
  paint?: string;
  paintMaterial?: string;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// The car modal's 3D stage. Shows `fallback` (the photo) until the model has
// loaded, then crossfades to it; on any failure (no WebGL, missing file) the
// photo simply stays.
export function CarScene({ model, fallback, children }: { model: CarModelConfig; fallback: ReactNode; children?: (viewer: CarViewer) => ReactNode }) {
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
  }, [model.url, model.paint, model.paintMaterial]);

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
          {children?.(viewer)}
          <button className={`car-stage-btn ${inside ? 'active' : ''}`} onClick={toggleInside} aria-pressed={inside}>
            <Icon name={inside ? 'car' : 'seat'} size={18} />
            {inside ? 'Outside' : 'Inside'}
          </button>
        </>
      )}
    </div>
  );
}
