import { useId } from 'react';
import { cssRgb, type RGB } from '../lib/lightColor';

// mdiLightbulbOn split into parts that can light up separately: the solid
// glass (what you see when off), a lit glass on top with a warm fill and a
// filament, the rays, and a halo behind. Switching on, the glass catches with
// a brief flicker, the rays grow out of the bulb one after another and the
// halo blooms; switching off, the glass dims, the filament glows on a moment
// longer (afterglow) and the rays draw back in. Brightness (0–1) scales the
// halo and the rays, and `color` (what the light gives off) tints the lit glass. All CSS transitions/animations on opacity and transform
// (the "Light icon" block in app.css).
const GLASS = 'M12 6A6 6 0 0 1 18 12C18 14.22 16.79 16.16 15 17.2V19A1 1 0 0 1 14 20H10A1 1 0 0 1 9 19V17.2C7.21 16.16 6 14.22 6 12A6 6 0 0 1 12 6Z';
const BASE = 'M14 21V22A1 1 0 0 1 13 23H11A1 1 0 0 1 10 22V21H14Z';
const FILAMENT = 'M10.2 15.6V13.4L11.1 12.2L12 13.4L12.9 12.2L13.8 13.4V15.6';
// Rays, centre first, so the stagger runs outwards.
const RAYS = ['M11 1H13V4H11Z', 'M4.92 3.5L7.05 5.64L5.63 7.05L3.5 4.93Z', 'M16.95 5.63L19.07 3.5L20.5 4.93L18.37 7.05Z', 'M1 11H4V13H1Z', 'M20 11H23V13H20Z'];

export function LightIcon({ on, brightness = 1, color, size = 24 }: { on: boolean; brightness?: number; color?: RGB; size?: number }) {
  const halo = `halo-${useId().replace(/:/g, '')}`;
  const b = Math.min(1, Math.max(0, brightness));
  return (
    <svg className={`light-icon ${on ? 'on' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ ['--b' as string]: b.toFixed(2), ['--lit' as string]: color ? `color-mix(in srgb, ${cssRgb(color)} 55%, #fff)` : undefined }}>
      <defs>
        <radialGradient id={halo}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="halo" cx="12" cy="12" r="11" fill={`url(#${halo})`} />
      {RAYS.map((d, i) => <path key={i} className="ray" d={d} fill="currentColor" style={{ transitionDelay: on ? `${i * 45}ms` : '0ms' }} />)}
      <path d={GLASS} fill="currentColor" />
      <path className="lit" d={GLASS} />
      <path className="filament" d={FILAMENT} />
      <path d={BASE} fill="currentColor" />
    </svg>
  );
}
