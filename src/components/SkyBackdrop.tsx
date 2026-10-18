import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HOME_ZONE, SUN, WEATHER } from '../config/entities';
import { useEntity } from '../ha/store';
import { useNow } from '../hooks/useNow';
import { moonLitPath } from '../lib/sky';
import { boltPaths, cloudSvg, planStrike, rand, type CloudTile, type Strike } from '../lib/skyArt';
import { skyScene, windKmh, type SkyScene, type SunInput } from '../lib/skyScene';
import { simSun } from '../lib/skySim';
import { city, DECK_Y } from '../lib/city';
import { LAND_H, ridgePath, RISE } from '../lib/terrain';
import { growTree, treeMasks } from '../lib/tree';
import { SKY_TEST, SkyTestPanel, type SkySim } from './SkyTestPanel';
import { useBitmapMask } from './useBitmapMask';

// Full-page sky behind every layout: the colours follow the sun's elevation
// (night, blue hour, dawn/dusk, golden hour, day) and the weather dulls them.
// The sun and moon sit where they are in the sky (east on the right), the moon
// in its phase; clouds are lit by whichever is up; a city skyline sits along
// the bottom. The wind shows only through what it moves (the tree, clouds,
// rain); haze and condensation show the humidity. Static or once-rasterised images
// that only move with transform/opacity, so the kiosk can run it all day.

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function SkyBackdrop() {
  const sun = useEntity(SUN);
  const weather = useEntity(WEATHER);
  const home = useEntity(HOME_ZONE);
  const now = useNow(60_000); // moves the sun and moon, and the fallback elevation
  const [sim, setSim] = useState<SkySim>(() => ({ hour: null, condition: null, wind: null, humidity: null, moon: null }));

  const sa = sun?.attributes ?? {};
  const wa = weather?.attributes ?? {};
  let sunInput: SunInput = {
    aboveHorizon: sun ? sun.state === 'above_horizon' : true,
    elevation: num(sa.elevation),
    azimuth: num(sa.azimuth),
    rising: typeof sa.rising === 'boolean' ? sa.rising : undefined,
    nextRising: sa.next_rising as string | undefined,
    nextSetting: sa.next_setting as string | undefined,
  };
  let at = now.getTime();
  if (sim.hour !== null) ({ sun: sunInput, now: at } = simSun(sim.hour, now));
  const lat = num(home?.attributes.latitude);
  const lng = num(home?.attributes.longitude);
  const liveWind = num(wa.wind_speed);
  const condition = sim.condition ?? weather?.state;

  const s = skyScene({
    sun: sunInput,
    now: at,
    condition,
    coverage: sim.condition === null ? num(wa.cloud_coverage) : undefined,
    wind: sim.wind ?? (liveWind === undefined ? undefined : windKmh(liveWind, wa.wind_speed_unit as string | undefined)),
    windBearing: num(wa.wind_bearing),
    humidity: sim.humidity ?? num(wa.humidity),
    location: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    moonPhase: sim.moon ?? undefined,
    modelMoon: sim.hour !== null || sim.moon !== null,
  });
  const { kind, heavy } = s;
  const night = s.elevation < -3; // darker rain once the light has gone

  const style = {
    '--sky-top': s.top,
    '--sky-mid': s.mid,
    '--sky-low': s.low,
    '--cloud-shade': s.cloud.shade,
    '--cloud-lit': s.cloud.lit,
    '--cloud-lit-a': s.cloud.litAlpha,
    '--day': s.day,
    '--stars': s.stars,
    '--sun': s.sun,
    '--disc': s.disc,
    '--horizon': s.horizon,
    '--haze': s.haze,
    '--haze-color': s.hazeColor,
    '--x': s.x,
    '--y': s.y,
    '--mx': s.moon.x,
    '--my': s.moon.y,
    '--moon': s.moon.opacity,
    '--moon-glow': s.moon.glow,
  } as CSSProperties;

  const rain = kind === 'rain' || (kind === 'storm' && condition !== 'lightning');
  // Panels see-through at night (the sky is dark, text stays clear) and nearly
  // solid by day (muted text over bright clouds); see --panel-a in app.css.
  const glass = Math.round(s.day * 10) / 10;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--panel-a', `${Math.round(48 + 32 * glass)}%`);
    root.setProperty('--card-a', `${Math.round(55 + 45 * glass)}%`);
  }, [glass]);
  const landWidth = useLandWidth();
  // The wind slants the rain (its streaks turned to match) and drifts the snow.
  const windStep = Math.round(s.wind.kmh / 5) * 5;
  const slant = s.wind.dir * Math.min(0.75, 0.06 + windStep / 70);
  const weatherStyle = {
    '--rain-dx': `${(slant * 115).toFixed(1)}vh`,
    '--rain-rot': `${((-Math.atan(slant) * 180) / Math.PI).toFixed(1)}deg`,
    '--snow-dx': `${(s.wind.dir * (2 + windStep * 0.6)).toFixed(1)}vw`,
  } as CSSProperties;
  return (
    <>
      <div
        className={`sky ${kind} ${night ? 'night' : 'day'} ${heavy ? 'heavy' : ''} ${SKY_TEST ? 'testing' : ''}`}
        style={{ ...style, ...weatherStyle }}
        aria-hidden="true"
      >
        <div className="sky-grad" />
        <div className="sky-horizon" />
        {s.stars > 0 && (
          <div className="sky-stars">
            <i className="a" />
            <i className="b" />
          </div>
        )}
        <div className="sky-veil" />
        <div className="sky-moonglow" />
        {s.moon.opacity > 0 && <Moon phase={s.moon.phase} angle={s.moon.angle} />}
        <div className="sky-body">
          {kind === 'clear' && s.sun > 0 && <div className="sky-rays" />}
          <div className="sky-sun" />
          <div className="sky-sundisc" />
        </div>
        {s.clouds > 0 && <Clouds scene={s} />}
        <CityBack scene={s} width={landWidth} />
        <Metro scene={s} />
        <Beacons scene={s} width={landWidth} />
        {kind === 'fog' && (
          <>
            <div className="sky-fog a" style={{ animationDuration: `${Math.round(110 / (1 + windStep / 15))}s` }} />
            <div className="sky-fog b" style={{ animationDuration: `${Math.round(150 / (1 + windStep / 15))}s` }} />
          </>
        )}
        <div className="sky-haze" />
        {kind === 'storm' && <Lightning />}
        <CityFront land={s.land} width={landWidth} />
        {rain && <Particles count={heavy ? 80 : 46} className="sky-drop" minDur={heavy ? 0.6 : 0.9} maxDur={heavy ? 0.95 : 1.4} />}
        {kind === 'snow' && <Particles count={40} className="sky-flake" minDur={10} maxDur={18} />}
        <Tree wind={s.wind} />
        {s.dew > 0 && <Dew amount={s.dew} />}
      </div>
      {SKY_TEST && <SkyTestPanel sim={sim} onChange={setSim} live={weather?.state} scene={s} />}
    </>
  );
}

// Particles falling from random columns.
function Particles({ count, className, minDur, maxDur }: { count: number; className: string; minDur: number; maxDur: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        pos: `${(rand(i, 1) * 104 - 2).toFixed(2)}%`,
        delay: `${(-rand(i, 2) * maxDur).toFixed(2)}s`,
        dur: `${(minDur + rand(i, 3) * (maxDur - minDur)).toFixed(2)}s`,
        scale: (0.6 + rand(i, 4) * 0.7).toFixed(2),
      })),
    [count, minDur, maxDur],
  );
  return (
    <>
      {items.map((p, i) => (
        <span key={i} className={className} style={{ left: p.pos, animationDelay: p.delay, animationDuration: p.dur, ['--s' as string]: p.scale }} />
      ))}
    </>
  );
}

// The moon disc in its phase: the lit part (with a few darker maria) turned so
// its bright limb faces the sun, and the rest faintly lit by earthshine.
function Moon({ phase, angle }: { phase: number; angle: number }) {
  // Draw it lit on the right (the waxing form for the same lit fraction), then turn.
  const lit = moonLitPath(0, 0, 48, phase <= 0.5 ? phase : 1 - phase);
  return (
    <svg className="sky-moon" viewBox="-50 -50 100 100">
      <defs>
        <radialGradient id="sky-moon-lit" cx="40%" cy="38%" r="70%">
          <stop offset="0" stopColor="#fdfcf6" />
          <stop offset="1" stopColor="#d7dbe6" />
        </radialGradient>
        <clipPath id="sky-moon-clip">
          <path d={lit} transform={`rotate(${angle})`} />
        </clipPath>
      </defs>
      <circle r="48" className="moon-earthshine" />
      <g clipPath="url(#sky-moon-clip)">
        <circle r="48" fill="url(#sky-moon-lit)" />
        <g className="moon-maria">
          <ellipse cx="-14" cy="-16" rx="13" ry="10" />
          <ellipse cx="10" cy="-20" rx="9" ry="7" />
          <ellipse cx="16" cy="2" rx="11" ry="13" />
          <ellipse cx="-8" cy="10" rx="8" ry="6" />
          <ellipse cx="-2" cy="30" rx="6" ry="4" />
        </g>
      </g>
    </svg>
  );
}

const NEAR: Omit<CloudTile, 'cover' | 'fade'> = { w: 1600, h: 640, freq: [0.0024, 0.0045], octaves: 4, seed: 7 };
const FAR: Omit<CloudTile, 'cover' | 'fade'> = { w: 1100, h: 520, freq: [0.0036, 0.0066], octaves: 4, seed: 23 };

// Two drifting layers of fractal-noise clouds. Each is a shaded body plus a
// lit side, both CSS masks over a flat colour, so the colours follow the time
// of day without re-rendering the images; only the cover and light direction
// (in 30° steps) rebuild them. They drift with the wind, slowly.
function Clouds({ scene }: { scene: SkyScene }) {
  const { clouds: cover, cloud, wind } = scene;
  const overcast = cover >= 0.8;
  const layers = useMemo(
    () =>
      [
        { name: 'far', tile: { ...FAR, cover: cover * 0.9, fade: overcast ? 0.6 : 0.35 } },
        { name: 'near', tile: { ...NEAR, cover, fade: overcast ? 0.7 : 0.4 } },
      ].map(({ name, tile }) => ({
        name,
        tile,
        shape: cloudSvg(tile, 'shape'),
        lit: cloudSvg(tile, 'lit', cloud.lightAz),
      })),
    [cover, overcast, cloud.lightAz],
  );
  // Real clouds crawl: ~4 px/s on a still day, faster with wind (in 5 km/h steps
  // so a jittery reading doesn't restart the drift).
  const kmh = Math.round(wind.kmh / 5) * 5;
  return (
    <>
      {layers.map(({ name, tile, shape, lit }) => (
        <CloudLayer key={name} name={name} tile={tile} shape={shape} lit={lit} speed={(4 + kmh * 0.3) * (name === 'far' ? 0.55 : 1)} dir={wind.dir} />
      ))}
    </>
  );
}

// One drifting layer, shown once its masks are bitmaps (useBitmapMask).
function CloudLayer({ name, tile, shape, lit, speed, dir }: { name: string; tile: CloudTile; shape: string; lit: string; speed: number; dir: number }) {
  const shapeMask = useBitmapMask(shape, tile.w, tile.h);
  const litMask = useBitmapMask(lit, tile.w, tile.h);
  if (!shapeMask || !litMask) return null;
  return (
    <div
      className={`sky-cloud ${name}`}
      style={
        {
          '--tile': `${tile.w}px`,
          animationDuration: `${Math.round(tile.w / speed)}s`,
          animationDirection: dir > 0 ? 'reverse' : 'normal',
        } as CSSProperties
      }
    >
      <div className="shade" style={{ WebkitMaskImage: shapeMask, maskImage: shapeMask }} />
      <div className="lit" style={{ WebkitMaskImage: litMask, maskImage: litMask }} />
    </div>
  );
}

// A thunderstorm: strikes at random times (0.7–5 s apart, in bursts) and
// random places across the page. Each flickers 1–3 times; most send a bolt to
// the ground, the rest only light the clouds from inside. The clouds glow
// around the strike, and a softer flash lights the whole sky.
//
// Kept cheap: the glow (a cloud texture lit from below, under a radial light)
// and the flash are drawn once and stay mounted; a strike only moves them
// (transform) and flickers them (opacity, WAAPI), so nothing repaints. The
// bolt is plain strokes with wide faint halo strokes, not CSS blur filters,
// which would be recomputed on every frame of the flicker.
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let glowCache: string | undefined;
const glowArt = () => (glowCache ??= cloudSvg({ ...NEAR, cover: 1, fade: 0.75 }, 'lit', 90, 18));

function Lightning() {
  const [strike, setStrike] = useState<(Strike & { id: number }) | null>(null);
  const flash = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const bolt = useRef<SVGSVGElement>(null);
  const mask = useBitmapMask(glowArt(), NEAR.w, NEAR.h);

  useEffect(() => {
    if (REDUCED) return;
    let id = 0;
    let timer = 0;
    const next = (delay: number) => {
      timer = window.setTimeout(() => {
        const s = planStrike(Math.random);
        if (!document.hidden) setStrike({ ...s, id: ++id });
        next(s.next);
      }, delay);
    };
    next(500);
    return () => window.clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    if (!strike || !flash.current || !glow.current) return;
    const timing: KeyframeAnimationOptions = { duration: strike.duration, easing: 'linear', fill: 'forwards' };
    const frames = strike.flicker as Keyframe[];
    // Never quite 0 for the glow: browsers drop (and must re-rasterise) a fully transparent mask layer.
    const scaled = (k: number, floor = 0) => frames.map((f) => ({ ...f, opacity: Math.max(floor, Math.min(1, (f.opacity as number) * k)) }));
    const x = strike.x * window.innerWidth;
    // Both are centred on their own box: the glow is 80vw wide, the flash 200vw.
    glow.current.style.transform = `translate3d(${Math.round(x - window.innerWidth * 0.4)}px, 0, 0)`;
    flash.current.style.transform = `translate3d(${Math.round(x - window.innerWidth)}px, 0, 0)`;
    // An in-cloud flash lights the clouds more and the open sky less.
    flash.current.animate(scaled(strike.bolt ? 0.38 : 0.22), timing);
    glow.current.animate(scaled(strike.bolt ? 0.9 : 1, 0.01), timing);
    bolt.current?.animate(frames, timing);
  }, [strike]);

  const paths = strike?.bolt ? boltPaths(strike.seed) : null;
  return (
    <>
      <div
        ref={glow}
        className="sky-glow"
        style={{ WebkitMaskImage: mask ?? 'linear-gradient(transparent, transparent)', maskImage: mask ?? 'linear-gradient(transparent, transparent)' }}
      />
      <div ref={flash} className="sky-flash" />
      {strike && paths && (
        <svg
          key={strike.id}
          ref={bolt}
          className="sky-bolt"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ left: `${(strike.x * 100 - 13).toFixed(1)}vw` }}
        >
          <path d={paths.main} className="halo wide" />
          <path d={paths.main} className="halo" />
          {paths.forks.map((d, i) => (
            <path key={i} d={d} className="fork" />
          ))}
          <path d={paths.main} />
        </svg>
      )}
    </>
  );
}

// The ground box along the bottom: as wide in units as the screen's aspect
// (LAND_H tall = 50vh), so the skyline is never stretched; re-measured on resize.
function useLandWidth() {
  const read = () => Math.round((LAND_H * window.innerWidth) / Math.max(1, window.innerHeight * 0.5));
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const onResize = () => setWidth(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

// The city (lib/city.ts): a hazy far skyline, the nearer one with
// a civic dome and the metro viaduct (one static SVG), trains crossing on it,
// aviation lights on the towers, and tree canopy in front (a second SVG).
// Windows light up from sunset; by day the towers' sunward faces catch the
// light. Only the trains (transform) and beacons (opacity) move.
// One skyline per screen width, shared by the back, the beacons and the front.
let cityCache: { width: number; art: ReturnType<typeof city> } | undefined;
function cityAt(width: number) {
  if (cityCache?.width !== width) cityCache = { width, art: city(width) };
  return cityCache.art;
}

const WARM = '#ffcf7a';
const COOL = '#d6e6ff';

function CityBack({ scene, width }: { scene: SkyScene; width: number }) {
  const c = cityAt(width);
  const { land, lights } = scene;
  return (
    <svg className="sky-land" viewBox={`0 0 ${width} ${LAND_H}`} preserveAspectRatio="none">
      <path d={c.far.body} fill={land.far} />
      <g opacity={(lights * 0.7).toFixed(2)}>
        <path d={c.far.warm} fill={WARM} />
        <path d={c.far.cool} fill={COOL} />
      </g>
      <defs>
        {/* glass and window grid, faint by day */}
        <pattern id="sky-facade" width="7" height="9" patternUnits="userSpaceOnUse">
          <rect x="2" y="2.5" width="3" height="4.2" fill="#dfe9f5" />
        </pattern>
      </defs>
      <path d={c.near.body} fill={land.mid} />
      <path d={c.near.body} fill="url(#sky-facade)" opacity={(scene.day * 0.16).toFixed(2)} />
      <path d={scene.x < 0.5 ? c.near.sunLeft : c.near.sunRight} fill={land.far} opacity={(scene.sun * scene.day * 0.45).toFixed(2)} />
      <g opacity={lights}>
        <path d={c.near.warm} fill={WARM} />
        <path d={c.near.cool} fill={COOL} />
      </g>
      <path d={c.viaduct} fill={land.hills} />
    </svg>
  );
}

// Units of the land box (LAND_H tall = 50vh) in vh.
const vh = (units: number) => `${((units / LAND_H) * 50).toFixed(3)}vh`;

function Metro({ scene }: { scene: SkyScene }) {
  const style = {
    bottom: vh(LAND_H - DECK_Y),
    height: vh(10),
    width: vh(150),
    '--train': `color-mix(in srgb, ${scene.land.mid} 55%, #6e4bb5)`,
    '--lit': scene.lights,
  } as CSSProperties;
  return (
    <>
      <i className="sky-train" style={style} />
      <i className="sky-train back" style={style} />
    </>
  );
}

function Beacons({ scene, width }: { scene: SkyScene; width: number }) {
  const c = cityAt(width);
  if (scene.lights < 0.15) return null;
  return (
    <div className="sky-beacons" style={{ opacity: scene.lights }}>
      {[...c.far.beacons, ...c.near.beacons].map(([x, y], i) => (
        <i key={i} style={{ left: `${((x / width) * 100).toFixed(2)}%`, bottom: vh(LAND_H - y), animationDelay: `${(-i * 0.37).toFixed(2)}s` }} />
      ))}
    </div>
  );
}

function CityFront({ land, width }: { land: SkyScene['land']; width: number }) {
  const c = cityAt(width);
  const rise = useMemo(() => ridgePath(RISE, width), [width]);
  return (
    <svg className="sky-land" viewBox={`0 0 ${width} ${LAND_H}`} preserveAspectRatio="none">
      <path d={c.canopy} fill={land.hills} />
      <path d={rise} fill={land.fore} />
    </svg>
  );
}

// A grown tree (lib/tree.ts) in the bottom corner, as CSS masks over the tree
// colour: the trunk, and each main limb (with its branches and leaves) as its
// own layer that sways about where it leaves the trunk. The whole tree leans
// downwind; the limbs swing harder and faster with the wind, each at its own pace.
let treeCache: ReturnType<typeof treeMasks> | undefined;
const treeArt = () => (treeCache ??= treeMasks(growTree(7)));

function Tree({ wind }: { wind: SkyScene['wind'] }) {
  const art = treeArt();
  const w = wind.level;
  const dur = 4.2 - 2.8 * w;
  const style = {
    '--lean': `${(wind.dir * (0.5 + 6 * w)).toFixed(1)}deg`,
    '--sway': `${(wind.dir * (0.6 + 4.5 * w)).toFixed(1)}deg`,
  } as CSSProperties;
  return (
    <div className="sky-tree" style={style}>
      <div className="tree-lean">
        <i className="tree-part" style={{ WebkitMaskImage: art.trunk, maskImage: art.trunk }} />
        {art.limbs.map((limb, i) => (
          <i
            key={i}
            className="tree-part limb"
            style={{
              WebkitMaskImage: limb.mask,
              maskImage: limb.mask,
              transformOrigin: `${limb.origin[0].toFixed(1)}% ${limb.origin[1].toFixed(1)}%`,
              animationDuration: `${(dur * (0.85 + i * 0.13)).toFixed(2)}s`,
              animationDelay: `${(-i * 0.9).toFixed(1)}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Condensation on the glass: beads that grow in number with the humidity (and
// rain), a few of which slowly trickle down.
function Dew({ amount }: { amount: number }) {
  const count = Math.round(10 + amount * 50);
  const beads = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(rand(i, 21) * 100).toFixed(2)}%`,
        top: `${(100 - rand(i, 22) ** 1.6 * 32).toFixed(2)}%`, // along the bottom, like a misted window
        size: `${(2.5 + rand(i, 23) ** 2.5 * 9).toFixed(1)}px`,
        trickle: i < 4 && amount > 0.4,
        dur: `${(24 + rand(i, 24) * 20).toFixed(1)}s`,
        delay: `${(-rand(i, 25) * 30).toFixed(1)}s`,
      })),
    [count, amount],
  );
  return (
    <div className="sky-dew" style={{ opacity: 0.3 + 0.5 * amount }}>
      {beads.map((b, i) => (
        <i
          key={i}
          className={b.trickle ? 'trickle' : undefined}
          style={{ left: b.left, top: b.top, width: b.size, height: b.size, animationDuration: b.dur, animationDelay: b.delay }}
        />
      ))}
    </div>
  );
}
