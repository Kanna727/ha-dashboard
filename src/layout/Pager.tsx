import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dragOffset, lockAxis, releaseDir, settleMs, stepPage, SWIPE } from '../lib/swipe';

// Pages that follow the finger (the owner asked for swipes that feel live):
// once a touch turns into a sideways drag, the neighbouring pages are put
// either side of the current one and all of them move with the finger, frame
// by frame. Letting go past 30 % of the width, or with a flick, finishes the
// move at the finger's speed; otherwise the page springs back. Where there is
// no page the drag stretches (rubber band). Touch only; mouse drags never
// change page.
//
// The track is moved through its style (no React render per finger move, so
// heavy pages don't stutter). Neighbours mount when a drag starts and stay
// mounted for a while after, so repeated swipes don't rebuild them.

// Things that use a sideways drag themselves (or must not change page): a
// drag that starts on one of these is theirs.
const OWN_DRAGS = [
  '.vmap', // vacuum map: pan, draw
  '.vrobot3d', // 3D robot: orbit
  '.car-stage-view', // 3D car: orbit
  '.slider',
  '.color-wheel',
  '.row-btn', // room chips: slide for speed and brightness
  '.nowplaying-pill', // swipes between players
  '.music-player',
  '.chips-row',
  '.card-grip',
  '.card-handle',
  'input',
  'select',
  'textarea',
  '[data-no-swipe]',
].join(',');

function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let e = el; e && e !== stop; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

// Not while a modal or sheet is open, or while cards are being arranged.
const busy = () => !!document.querySelector('.modal-backdrop, .sheet-backdrop, .cols.canvas.editing');
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
const WARM_MS = 30_000; // keep the neighbours this long after the last swipe

interface Props<T extends string> {
  pages: readonly T[];
  current: T;
  onChange: (page: T) => void;
  render: (page: T) => ReactNode;
  className?: string;
}

export function Pager<T extends string>({ pages, current, onChange, render, className = '' }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [sides, setSides] = useState(false); // neighbours mounted
  const [sideTop, setSideTop] = useState(0); // neighbours' top, so they start at the screen's top when the page is scrolled
  const [settle, setSettle] = useState<T | null>(null); // turning to this page
  const prev = stepPage(pages, current, -1);
  const next = stepPage(pages, current, 1);
  const live = useRef({ prev, next, current, onChange, settling: false });
  live.current = { prev, next, current, onChange, settling: settle !== null };
  const warm = useRef(0);

  const setX = (x: number, ms = 0) => {
    const t = track.current;
    if (!t) return;
    t.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
    t.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
  };
  const keepWarm = () => {
    window.clearTimeout(warm.current);
    warm.current = window.setTimeout(() => setSides(false), WARM_MS);
  };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let g: { x0: number; y0: number; axis: 'x' | 'y' | null; dx: number; w: number; samples: { t: number; x: number }[] } | null = null;

    const onStart = (e: TouchEvent) => {
      g = null;
      if (e.touches.length !== 1 || busy() || live.current.settling) return;
      const target = e.target as Element | null;
      if (target?.closest?.(OWN_DRAGS) || scrollsSideways(target, el)) return;
      const t = e.touches[0];
      if (t.clientX < SWIPE.edgePx || t.clientX > window.innerWidth - SWIPE.edgePx) return;
      g = { x0: t.clientX, y0: t.clientY, axis: null, dx: 0, w: el.clientWidth || window.innerWidth, samples: [{ t: e.timeStamp, x: t.clientX }] };
    };

    const onMove = (e: TouchEvent) => {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.axis) {
        g.axis = lockAxis(dx, dy);
        if (g.axis === 'y') return void (g = null); // a scroll: not ours
        if (!g.axis) return;
        // A page drag starts: put the neighbours beside this page.
        const top = el.getBoundingClientRect().top;
        setSideTop(top < 0 ? -top : 0);
        setSides(true);
        window.clearTimeout(warm.current);
      }
      e.preventDefault(); // the page mustn't scroll while it's being dragged sideways
      g.dx = dx;
      g.samples.push({ t: e.timeStamp, x: t.clientX });
      if (g.samples.length > 8) g.samples.shift();
      // Straight away, not on the next frame: touch moves already come once a frame,
      // and waiting would leave the page a frame behind the finger.
      const { prev: p, next: n } = live.current;
      setX(dragOffset(dx, !!p, !!n));
    };

    const onEnd = (e: TouchEvent) => {
      const s = g;
      g = null;
      if (!s || s.axis !== 'x') return;
      // Velocity over the last ~100 ms of movement.
      // A finger that stopped before letting go has no speed (the page then turns only past 30 %).
      const now = e.timeStamp;
      const last = s.samples[s.samples.length - 1];
      const recent = s.samples.filter((p) => now - p.t <= 100);
      const first = recent[0];
      const v = now - last.t > 100 || !first || last.t <= first.t ? 0 : (last.x - first.x) / (last.t - first.t);
      const { prev: p, next: n, onChange: change } = live.current;
      const dir = releaseDir(s.dx, v, s.w, !!p, !!n);
      if (!dir) {
        setX(0, reduced() ? 0 : 240);
        keepWarm();
        return;
      }
      const target = (dir === 1 ? n : p)!;
      const ms = reduced() ? 0 : settleMs(s.w - Math.abs(s.dx), v);
      setX(-dir * s.w, ms);
      setSettle(target);
      window.setTimeout(() => change(target), ms);
    };

    const onCancel = () => {
      if (g?.axis === 'x') setX(0, 240);
      g = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  // The new page is current now: put the track back (before paint, so nothing
  // jumps), and line the page up with the screen if it was scrolled.
  useLayoutEffect(() => {
    if (settle === null || current !== settle) return;
    setX(0);
    setSettle(null);
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy(0, top);
    keepWarm();
  }, [current, settle]);

  useEffect(() => () => window.clearTimeout(warm.current), []);

  const slots = (sides ? [prev, current, next] : [current]).filter((x): x is T => !!x);
  return (
    <div ref={root} className={`pager ${className}`}>
      <div ref={track} className="pager-track">
        {slots.map((id) => (
          <div
            key={id}
            className={`pager-page ${id === current ? 'current' : 'side'}`}
            style={id === current ? undefined : { left: id === prev ? '-100%' : '100%', top: sideTop }}
            aria-hidden={id !== current || undefined}
          >
            {render(id)}
          </div>
        ))}
      </div>
    </div>
  );
}
