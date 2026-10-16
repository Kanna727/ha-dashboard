import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { snapPercent } from '../lib/fanSpeed';

const MOVE_THRESHOLD = 10; // px before a press counts as a slide (or a scroll)
const SETTLE_MS = 4000; // how long a committed value is shown while HA catches up

const LONG_PRESS_MS = 450;

interface SlideOptions {
  value: number; // current value, 0–100
  step: number; // snap size, e.g. a fan's percentage_step
  enabled: boolean;
  onCommit: (v: number) => void;
  axis?: 'x' | 'y'; // 'y': drag up to raise (default 'x')
  range?: number; // px for a full 0–100 sweep (default: the element's size along the axis)
  keyStep?: number; // arrow-key step (default `step`)
  onInput?: (v: number) => void; // live value while dragging
  onLongPress?: () => void; // a still press of 450 ms; its click is swallowed
}

// Slide across an element to set a 0–100 value. The value moves relative to
// where it was when the drag began, so grabbing anywhere doesn't make it jump.
// Taps still click, and drags along the other axis are left alone (for 'x' the
// element needs `touch-action: pan-y` so vertical drags still scroll). The
// click that ends a slide or a long press is swallowed, so neither also opens
// or toggles something.
export function useSlide({ value, step, enabled, onCommit, axis = 'x', range, keyStep = step, onInput, onLongPress }: SlideOptions) {
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; start: number; width: number; active: boolean; id: number } | null>(null);
  const swallowClick = useRef(false);
  const press = useRef<number>();
  const endPress = () => {
    window.clearTimeout(press.current);
    press.current = undefined;
  };
  const swallowNextClick = () => {
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 300);
  };
  useEffect(() => endPress, []);
  // Distance along the slide axis (up is positive for 'y') and across it.
  const along = (dx: number, dy: number) => (axis === 'x' ? dx : -dy);
  const across = (dx: number, dy: number) => (axis === 'x' ? dy : dx);
  const snap = (v: number) => snapPercent(v, step);

  // Once HA reports the new value (or after a while), drop the preview.
  useEffect(() => {
    if (dragging || preview === null) return;
    if (Math.abs(snap(value) - preview) < 0.5) return setPreview(null);
    const id = window.setTimeout(() => setPreview(null), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [value, preview, dragging]);

  // With live updates the device may already be at v, but the caller still
  // needs the final value (to flush its throttle).
  const commit = (v: number) => {
    setPreview(v);
    if (onInput || Math.abs(v - snap(value)) >= 0.5) onCommit(v);
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (onLongPress) {
        endPress();
        press.current = window.setTimeout(() => {
          press.current = undefined;
          drag.current = null;
          swallowNextClick();
          onLongPress();
        }, LONG_PRESS_MS);
      }
      if (!enabled) return;
      const r = e.currentTarget.getBoundingClientRect();
      const width = range ?? (axis === 'x' ? r.width : r.height);
      drag.current = { x: e.clientX, y: e.clientY, start: preview ?? snap(value), width, active: false, id: e.pointerId };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const a = along(e.clientX - d.x, e.clientY - d.y);
      const c = across(e.clientX - d.x, e.clientY - d.y);
      if (Math.hypot(a, c) > MOVE_THRESHOLD) endPress();
      if (!d.active) {
        if (Math.abs(c) > MOVE_THRESHOLD && Math.abs(c) > Math.abs(a)) {
          drag.current = null; // a drag along the other axis (e.g. a scroll), not ours
          return;
        }
        if (Math.abs(a) < MOVE_THRESHOLD) return;
        d.active = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const v = snap(d.start + (a / d.width) * 100);
      if (v !== preview) onInput?.(v);
      setPreview(v);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      endPress();
      const d = drag.current;
      drag.current = null;
      if (!d?.active) return;
      setDragging(false);
      swallowNextClick();
      commit(snap(d.start + (along(e.clientX - d.x, e.clientY - d.y) / d.width) * 100));
    },
    onPointerCancel() {
      endPress();
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
      const [up, down] = axis === 'x' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowUp', 'ArrowDown'];
      if (!enabled || (e.key !== up && e.key !== down)) return;
      e.preventDefault();
      e.stopPropagation(); // a focused button inside a slidable card
      commit(snap((preview ?? snap(value)) + (e.key === up ? keyStep : -keyStep)));
    },
  };

  return { value: preview ?? value, sliding: dragging, handlers };
}
