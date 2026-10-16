import { useEffect, useMemo, useRef } from 'react';
import { createThrottle } from '../lib/throttle';

// createThrottle (lib/throttle.ts) for a component: always calls the latest
// `send`, and drops anything pending on unmount.
export function useThrottle<T>(send: (v: T) => void, ms = 250) {
  const fn = useRef(send);
  fn.current = send;
  const t = useMemo(() => createThrottle<T>((v) => fn.current(v), ms), [ms]);
  useEffect(() => t.cancel, [t]);
  return t;
}
