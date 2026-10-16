import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cssRgb, hsToRgb, hsToWheel, wheelToHs, type HS } from '../lib/lightColor';

const SETTLE_MS = 3000;

// Hue round the rim (red at the top, clockwise), saturation out from the white
// centre. Press anywhere to pick, drag to adjust. `value` undefined (a light in
// white mode, or mixed settings) shows no handle.
export function ColorWheel({ value, onInput, onCommit }: { value?: HS; onInput?: (hs: HS) => void; onCommit: (hs: HS) => void }) {
  const [local, setLocal] = useState<HS | null>(null);
  const dragging = useRef(false);
  const shown = local ?? value;

  useEffect(() => {
    if (dragging.current || local === null) return;
    const id = window.setTimeout(() => setLocal(null), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [value, local]);

  const at = (e: PointerEvent<HTMLDivElement>): HS => {
    const r = e.currentTarget.getBoundingClientRect();
    return wheelToHs((e.clientX - r.left) / (r.width / 2) - 1, (e.clientY - r.top) / (r.height / 2) - 1);
  };
  const pos = shown && hsToWheel(shown);

  return (
    <div
      className="color-wheel"
      role="slider"
      aria-label="Colour"
      aria-valuetext={shown ? `hue ${shown[0]}°, saturation ${shown[1]}%` : 'none'}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        const hs = at(e);
        setLocal(hs);
        onInput?.(hs);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const hs = at(e);
        setLocal(hs);
        onInput?.(hs);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        const hs = at(e);
        setLocal(hs);
        onCommit(hs);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setLocal(null);
      }}
    >
      {pos && shown && (
        <span
          className="color-wheel-handle"
          style={{ left: `${50 + pos.x * 50}%`, top: `${50 + pos.y * 50}%`, background: cssRgb(hsToRgb(shown)) }}
        />
      )}
    </div>
  );
}
