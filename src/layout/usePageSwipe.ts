import { useEffect, useRef, useState } from 'react';
import { swipeDir, type TouchPoint } from '../lib/swipe';

// Things that use a sideways drag themselves (or must not change page): a swipe
// that starts on one of these is theirs.
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

function scrollsSideways(el: Element | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

// Not while a modal or sheet is open, or while cards are being arranged.
const busy = () => !!document.querySelector('.modal-backdrop, .sheet-backdrop, .cols.canvas.editing');

// Swipe left or right anywhere on the page to change page (the owner asked
// for it). Touch only: a mouse drag selects or arranges. Touch events, not
// pointer events, because the browser cancels a pointer once it starts
// scrolling, while touchend always arrives. `enter` is the direction of the
// last swipe for a moment afterwards, for the incoming page's slide-in.
export function usePageSwipe(onSwipe: (dir: 1 | -1) => boolean): 'next' | 'prev' | null {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  const [enter, setEnter] = useState<'next' | 'prev' | null>(null);

  useEffect(() => {
    let start: TouchPoint | null = null;
    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1 || busy()) return;
      const target = e.target as Element | null;
      if (target?.closest?.(OWN_DRAGS) || scrollsSideways(target)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dir = swipeDir(s, { x: t.clientX, y: t.clientY, t: e.timeStamp }, window.innerWidth);
      if (dir && cb.current(dir)) setEnter(dir === 1 ? 'next' : 'prev');
    };
    const onCancel = () => (start = null);
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  // The slide-in plays once, on the page that mounts now.
  useEffect(() => {
    if (!enter) return;
    const t = window.setTimeout(() => setEnter(null), 450);
    return () => window.clearTimeout(t);
  }, [enter]);

  return enter;
}
