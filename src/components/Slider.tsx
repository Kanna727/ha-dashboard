import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

const SETTLE_MS = 3000; // how long a committed value is shown while HA catches up

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  valueText?: string;
  className?: string;
  style?: CSSProperties;
  onInput?: (v: number) => void; // while dragging
  onCommit: (v: number) => void; // on release, or a key press
  children?: ReactNode;
}

// A horizontal pill slider driven by pointer events: press anywhere on the
// track to jump there, drag to adjust. (iOS range inputs only follow drags
// that start on the thumb.) Exposes the position as --pos (0–1) for the fill
// and thumb. Shows the committed value until HA reports it.
export function Slider({ value, min = 0, max = 100, step = 1, label, valueText, className = '', style, onInput, onCommit, children }: SliderProps) {
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown = local ?? value;

  useEffect(() => {
    if (dragging.current || local === null) return;
    if (Math.abs(value - local) < step) return setLocal(null);
    const id = window.setTimeout(() => setLocal(null), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [value, local, step]);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round((min + f * (max - min)) / step) * step;
  };
  const keyStep = Math.max(step, (max - min) / 20);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = { ArrowRight: keyStep, ArrowUp: keyStep, ArrowLeft: -keyStep, ArrowDown: -keyStep }[e.key];
    const v = e.key === 'Home' ? min : e.key === 'End' ? max : d !== undefined ? Math.min(max, Math.max(min, shown + d)) : undefined;
    if (v === undefined) return;
    e.preventDefault();
    setLocal(v);
    onCommit(v);
  };

  return (
    <div
      className={`slider ${className}`}
      style={{ ...style, ['--pos' as string]: (shown - min) / (max - min) }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        const v = at(e);
        setLocal(v);
        onInput?.(v);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const v = at(e);
        if (v !== local) {
          setLocal(v);
          onInput?.(v);
        }
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        const v = at(e);
        setLocal(v);
        onCommit(v);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setLocal(null);
      }}
    >
      <span className="slider-fill" />
      <span className="slider-thumb" />
      {children}
    </div>
  );
}
