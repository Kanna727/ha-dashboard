import { useRef, type PointerEvent } from 'react';

// Tap -> onTap, hold 450ms -> onLongPress. Moving the finger cancels, so
// scrolling a phone layout never toggles a light.
export function useLongPress(onTap: () => void, onLongPress?: () => void, ms = 450) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return {
    onPointerDown(e: PointerEvent) {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      if (onLongPress) {
        timer.current = window.setTimeout(() => {
          fired.current = true;
          onLongPress();
        }, ms);
      }
    },
    onPointerMove(e: PointerEvent) {
      if (!start.current) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) {
        clear();
        start.current = null;
      }
    },
    onPointerUp() {
      clear();
      if (start.current && !fired.current) onTap();
      start.current = null;
    },
    onPointerCancel() {
      clear();
      start.current = null;
    },
    onContextMenu(e: { preventDefault(): void }) {
      e.preventDefault();
    },
  };
}
