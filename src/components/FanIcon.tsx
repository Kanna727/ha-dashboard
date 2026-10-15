import { useEffect, useRef } from 'react';

// The ceiling fan from mdiCeilingFan, split so only the blades move: the mount,
// rod and motor are a static SVG, and the blades are drawn top-down in their
// own layer, tilted almost edge-on (we see the fan from slightly below) and
// spun in that plane. So they sweep round the hub with real foreshortening,
// instead of the whole icon flipping.
const MOUNT = 'M8 3V5H11V10.27C10.38 10.63 10 11.29 10 12V13H14V12C14 11.29 13.62 10.63 13 10.27V5H16V3H8Z';
const BOWL = 'M10 14V15C10 15.72 10.38 16.38 11 16.73C11.62 17.09 12.38 17.09 13 16.73C13.62 16.38 14 15.71 14 15V14H10Z';
const BLADE = 'M2-1.5L9-2.4Q10.8-2.3 10.8 0Q10.8 2.3 9 2.4L2 1.5Z';

// Seconds per turn: ~1.4 s at the lowest speed, 0.6 s flat out.
const periodMs = (pct?: number) => (1.6 - Math.min(100, Math.max(0, pct ?? 60)) / 100) * 1000;

// Current rotation of an element whose only transform is a rotate().
function angleOf(el: HTMLElement) {
  const m = /matrix\(([^,]+),\s*([^,]+)/.exec(getComputedStyle(el).transform);
  return m ? (Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180) / Math.PI : 0;
}

// Drives the blades with the Web Animations API (compositor-run, like CSS
// transforms) so speed changes and stops pick up from the current angle:
// - turning on spins up over one turn, ending at full speed, then loops;
// - a speed change switches the loop's pace from where the blades are;
// - turning off coasts to a stop over one turn, starting at the old speed.
// The spin-up and coast easings have an end/start slope of 2, so taking two
// periods for the turn matches the loop's speed exactly (no jolt).
// prefers-reduced-motion doesn't stop WAAPI animations, so it's checked here.
function useSpin(on: boolean, pct?: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation>();
  const spinning = useRef(false);
  const lastPeriod = useRef(periodMs(pct));
  const period = periodMs(pct);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = angleOf(el);
    anim.current?.cancel();
    const turn = (ms: number, easing: string, iterations = 1) =>
      el.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 360}deg)` }], { duration: ms, easing, iterations, fill: 'forwards' });
    if (on) {
      const loop = () => {
        const up = anim.current;
        anim.current = turn(period, 'linear', Infinity);
        up?.cancel(); // the finished spin-up would otherwise linger, filling
      };
      if (spinning.current) loop();
      else {
        anim.current = turn(period * 2, 'cubic-bezier(0.55, 0, 0.75, 0.5)');
        anim.current.onfinish = loop;
      }
      lastPeriod.current = period;
    } else if (spinning.current) {
      anim.current = turn(lastPeriod.current * 2, 'cubic-bezier(0.25, 0.5, 0.45, 1)');
    }
    spinning.current = on;
  }, [on, period]);

  useEffect(() => () => anim.current?.cancel(), []);
  return ref;
}

export function FanIcon({ on, pct, size = 24 }: { on: boolean; pct?: number; size?: number }) {
  const blades = useSpin(on, pct);
  return (
    <span className="fan-icon" style={{ width: size, height: size }} aria-hidden="true">
      <span className="fan-plane">
        <span ref={blades} className="fan-blades">
          <svg viewBox="-11 -11 22 22">
            <circle r="2.2" fill="currentColor" />
            {[0, 120, 240].map((r) => <path key={r} d={BLADE} transform={`rotate(${r + 30})`} fill="currentColor" />)}
          </svg>
        </span>
      </span>
      <svg viewBox="0 0 24 24">
        <path d={MOUNT} fill="currentColor" />
        <path d={BOWL} fill="currentColor" />
      </svg>
    </span>
  );
}
