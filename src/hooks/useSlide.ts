import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

const MOVE_THRESHOLD = 10; // px before a press counts as a slide (or a scroll)
const SETTLE_MS = 4000; // how long a committed value is shown while HA catches up

const clamp = (v: number) => Math.min(100, Math.max(0, v));

interface SlideOptions {
  value: number; // current value, 0–100
  step: number; // snap size, e.g. a fan's percentage_step
  enabled: boolean;
  onCommit: (v: number) => void;
}

// Horizontal slide across an element to set a 0–100 value. The value moves
// relative to where it was when the drag began, so grabbing anywhere doesn't
// make it jump. Taps still click, and vertical drags still scroll (the element
// needs `touch-action: pan-y`). The click that ends a slide is swallowed, so a
// slide never also opens or toggles something.
export function useSlide({ value, step, enabled, onCommit }: SlideOptions) {
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; start: number; width: number; active: boolean; id: number } | null>(null);
  const swallowClick = useRef(false);
  const snap = (v: number) => clamp(Math.round(v / step) * step);

  // Once HA reports the new value (or after a while), drop the preview.
  useEffect(() => {
    if (dragging || preview === null) return;
    if (Math.abs(snap(value) - preview) < 0.5) return setPreview(null);
    const id = window.setTimeout(() => setPreview(null), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [value, preview, dragging]);

  const commit = (v: number) => {
    setPreview(v);
    if (Math.abs(v - snap(value)) >= 0.5) onCommit(v);
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const width = e.currentTarget.getBoundingClientRect().width;
      drag.current = { x: e.clientX, y: e.clientY, start: preview ?? snap(value), width, active: false, id: e.pointerId };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.active) {
        if (Math.abs(dy) > MOVE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
          drag.current = null; // a vertical scroll, not ours
          return;
        }
        if (Math.abs(dx) < MOVE_THRESHOLD) return;
        d.active = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setPreview(snap(d.start + (dx / d.width) * 100));
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      drag.current = null;
      if (!d?.active) return;
      setDragging(false);
      swallowClick.current = true;
      window.setTimeout(() => (swallowClick.current = false), 300);
      commit(snap(d.start + ((e.clientX - d.x) / d.width) * 100));
    },
    onPointerCancel() {
      if (drag.current?.active) {
        setDragging(false);
        setPreview(null);
      }
      drag.current = null;
    },
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (!enabled || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      commit(snap((preview ?? snap(value)) + (e.key === 'ArrowRight' ? step : -step)));
    },
  };

  return { value: preview ?? value, sliding: dragging, handlers };
}
