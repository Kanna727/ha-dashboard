import { useEffect, useRef, useState } from 'react';
import { tweenAt } from '../lib/energyFlow';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Glides a displayed number to its new value (ease-out over `ms`) instead of
// jumping. Runs requestAnimationFrame only while a change is in flight; jumps
// straight there under reduced motion or when either end is unknown.
export function useTweenedNumber(target: number | undefined, ms = 700): number | undefined {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (target === undefined || from === undefined || from === target || reducedMotion()) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = (now - start) / ms;
      const v = tweenAt(from, target, k);
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return shown;
}
