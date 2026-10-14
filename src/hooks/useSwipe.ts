import { useRef, type PointerEvent, type MouseEvent } from 'react';

// Horizontal swipe (touch or mouse drag). Spread the result onto an element.
// Swipes that start inside `.chips-row` are ignored, since that row scrolls sideways.
// A swipe also swallows the click that follows it, so a slide never taps a button.
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown: (e: PointerEvent) => {
      swiped.current = false;
      start.current = (e.target as Element).closest('.chips-row') ? null : { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped.current = true;
        onSwipe(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onClickCapture: (e: MouseEvent) => {
      if (swiped.current) {
        swiped.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}

// Next/previous entry of `list` around `current`, wrapping. Falls back to the first entry.
export function cycle<T>(list: T[], current: T, dir: 1 | -1): T {
  const i = list.indexOf(current);
  return i < 0 ? list[0] : list[(i + dir + list.length) % list.length];
}
