// Offline commute for the mock: a fake commute card config, made-up routes
// with speed readings, and an SVG stand-in for Google Maps and Places search.
// Nothing here reaches the production bundle.
import { useMemo, useRef, useState } from 'react';
import { COMMUTE } from '../src/config/entities';
import { ALT_ROUTE_COLOR, decodePolyline, fmtMin, forceCommuteWindow, kmText, setRoutesImpl, SPEED_COLORS, type LatLng, type Route, type RoutesRequest, type Speed } from '../src/commute/routes';
import { COMMUTE_TEST_EVENT } from '../src/commute/useCommute';
import { setCommuteViews, type MapViewProps, type PlaceSearchProps } from '../src/commute/views';

export type Traffic = 'light' | 'moderate' | 'heavy';
// window: null follows the clock and the config's commute window; true/false pins it.
export const commuteMock = { traffic: 'moderate' as Traffic, error: false, window: null as boolean | null };

// A fictional town; the coordinates only place the drawing.
const HOME = { lat: 51.5, lng: -0.12 };
const OFFICE = { lat: 51.578, lng: 0.012 };

export const MOCK_COMMUTE_CARD = {
  type: COMMUTE.cardType,
  title: 'Home → Office',
  api_key: 'mock',
  origin_lat: HOME.lat,
  origin_lng: HOME.lng,
  dest_lat: OFFICE.lat,
  dest_lng: OFFICE.lng,
  alert_threshold_minutes: 45,
  default_vehicle: 'DRIVE',
};

const FROZEN = new URLSearchParams(window.location.search).has('mockFreeze');

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function encodePolyline(path: LatLng[]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of path) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    enc(lat - pLat);
    enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

// A street-like path: a curve from A to B, walked in long L-shaped blocks
// with a little wobble, like a drive through a street grid.
function fakePath(a: LatLng, b: LatLng, bend: number, seed: number): LatLng[] {
  const rand = seeded(seed);
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const ctrl = { lat: mid.lat + (b.lng - a.lng) * bend, lng: mid.lng - (b.lat - a.lat) * bend };
  const at = (t: number) => ({ lat: (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * ctrl.lat + t * t * b.lat, lng: (1 - t) ** 2 * a.lng + 2 * (1 - t) * t * ctrl.lng + t * t * b.lng });
  const out: LatLng[] = [a];
  const N = 7;
  for (let i = 1; i <= N; i++) {
    const p = at(i / N);
    const prev = out[out.length - 1];
    const corner = i % 2 ? { lat: prev.lat, lng: p.lng } : { lat: p.lat, lng: prev.lng };
    // Each leg as a few points, so speed readings can start mid-street.
    for (const [from, to] of [[prev, corner], [corner, p]] as const) {
      for (let k = 1; k <= 4; k++) {
        const f = k / 4;
        const w = k < 4 ? (rand() - 0.5) * 0.0004 : 0;
        out.push({ lat: from.lat + (to.lat - from.lat) * f + w, lng: from.lng + (to.lng - from.lng) * f + w });
      }
    }
  }
  return out;
}

const PATTERNS: Record<Traffic, [number, number, Speed][][]> = {
  light: [[[0.62, 0.67, 'SLOW']], [[0.3, 0.36, 'SLOW']], [[0.45, 0.5, 'SLOW']]],
  moderate: [
    [[0.18, 0.28, 'SLOW'], [0.52, 0.58, 'TRAFFIC_JAM'], [0.58, 0.68, 'SLOW']],
    [[0.1, 0.2, 'SLOW'], [0.6, 0.7, 'SLOW']],
    [[0.3, 0.45, 'SLOW'], [0.45, 0.5, 'TRAFFIC_JAM']],
  ],
  heavy: [
    [[0.08, 0.22, 'SLOW'], [0.22, 0.4, 'TRAFFIC_JAM'], [0.48, 0.6, 'SLOW'], [0.6, 0.76, 'TRAFFIC_JAM']],
    [[0.15, 0.35, 'SLOW'], [0.55, 0.62, 'TRAFFIC_JAM'], [0.62, 0.8, 'SLOW']],
    [[0.2, 0.5, 'TRAFFIC_JAM'], [0.5, 0.7, 'SLOW']],
  ],
};
const FACTOR: Record<Traffic, number[]> = { light: [1.08, 1.06, 1.1], moderate: [1.32, 1.3, 1.42], heavy: [1.7, 1.62, 1.85] };
// Trip time when leaving later, as a share of leaving now.
const LATER: Record<Traffic, Record<number, number>> = {
  light: { 15: 1.03, 30: 1.06, 45: 1.1 },
  moderate: { 15: 0.93, 30: 0.82, 45: 0.87 },
  heavy: { 15: 0.88, 30: 0.72, 45: 0.78 },
};
const ROUTES = [
  { bend: 0.06, km: 1, base: 26, via: 'Ring Road' },
  { bend: 0.42, km: 1.12, base: 28, via: 'River Road' },
  { bend: -0.36, km: 0.97, base: 30, via: 'Station Road' },
];

async function mockRoutes(req: RoutesRequest): Promise<Route[]> {
  if (!FROZEN) await new Promise((r) => setTimeout(r, 500));
  if (req.signal?.aborted) throw new Error('aborted');
  if (commuteMock.error) {
    throw new Error("Google refused the request. Check billing is enabled on the API key's Cloud project, and that Routes API is enabled and allowed for the key.");
  }
  const t = commuteMock.traffic;
  const bike = req.mode === 'TWO_WHEELER' ? 0.82 : 1;
  const straight = Math.hypot(req.dest.lat - req.origin.lat, (req.dest.lng - req.origin.lng) * 0.62) * 111;
  const seed = Math.round((req.origin.lat + req.dest.lng) * 1e4);
  const list = (req.alternatives ? ROUTES : ROUTES.slice(0, 1)).map((spec, k) => {
    const path = fakePath(req.origin, req.dest, spec.bend, seed + k);
    const n = path.length - 1;
    const meters = Math.round(straight * 1.3 * spec.km * 1000);
    const staticSeconds = Math.round(((spec.base * meters) / 14_000) * 60 * bike);
    const later = req.departureOffsetMin ? LATER[t][req.departureOffsetMin] ?? 1 : 1;
    const factor = 1 + (FACTOR[t][k] - 1) * (bike < 1 ? 0.7 : 1);
    return {
      seconds: Math.round(Math.max(staticSeconds, staticSeconds * factor * later)),
      staticSeconds,
      meters,
      description: spec.via,
      encodedPolyline: encodePolyline(path),
      intervals: PATTERNS[t][k].map(([a, b, speed]) => ({ start: Math.round(a * n), end: Math.round(b * n), speed })),
    };
  });
  return list;
}

// ---------- SVG map ----------

const PLACES = [
  { label: 'Central Station', d: [0.03, 0.05] },
  { label: 'Riverside Mall', d: [-0.02, 0.09] },
  { label: 'City Hospital', d: [0.05, -0.04] },
  { label: 'Airport', d: [0.11, 0.16] },
  { label: 'Old Town Library', d: [0.015, -0.07] },
];

function MockMapView({ routes, origin, dest, selected, onSelect, height, padding }: MapViewProps) {
  const [tip, setTip] = useState<string | null>(null);
  const paths = useMemo(() => routes?.map((r) => decodePolyline(r.encodedPolyline)) ?? [], [routes]);
  const all = [...paths.flat(), ...(origin ? [origin] : []), ...(dest ? [dest] : [])];
  const k = 0.62;
  const xs = all.map((p) => p.lng * k);
  const ys = all.map((p) => -p.lat);
  const [x0, x1, y0, y1] = all.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, 1, 0, 1];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const S = 1000 / span;
  // Padding in px, taken against a ~900 px wide map.
  const px = (v = 0) => (v / 900) * span * 1.6;
  const pad = 0.12 * span;
  const [pt, pr, pb, pl] = [pad + px(padding?.top), pad + px(padding?.right), pad + px(padding?.bottom), pad + px(padding?.left)];
  const vb = [(x0 - pl) * S, (y0 - pt) * S, (x1 - x0 + pl + pr) * S, (y1 - y0 + pt + pb) * S];
  const P = (p: LatLng) => [p.lng * k * S, -p.lat * S] as const;
  const pts = (ps: LatLng[]) => ps.map((p) => P(p).map((v) => v.toFixed(1)).join(',')).join(' ');

  // Background streets, water and parks around the routes (fixed per area).
  const scenery = useMemo(() => {
    const rand = seeded(7);
    const cx = vb[0] + vb[2] / 2;
    const cy = vb[1] + vb[3] / 2;
    const R = Math.max(vb[2], vb[3]) * 1.6;
    const minor: string[] = [];
    for (let i = -24; i <= 24; i++) {
      const o = i * (R / 24) + rand() * 20;
      minor.push(`M${cx - R},${cy + o} L${cx + R},${cy + o + (rand() - 0.5) * 80}`, `M${cx + o},${cy - R} L${cx + o + (rand() - 0.5) * 80},${cy + R}`);
    }
    const parks = Array.from({ length: 9 }, () => ({ x: cx + (rand() - 0.5) * R, y: cy + (rand() - 0.5) * R, w: 60 + rand() * 140, h: 50 + rand() * 110 }));
    return { minor, parks, cx, cy, R };
  }, [Math.round(vb[0] / 200), Math.round(vb[1] / 200)]);

  const sel = routes?.[selected];
  const selPath = paths[selected] ?? [];
  return (
    <div className="commute-map" style={{ height }}>
      <svg className="mock-map" viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid meet">
        <rect x={scenery.cx - scenery.R} y={scenery.cy - scenery.R} width={scenery.R * 2} height={scenery.R * 2} fill="#1b202b" />
        {scenery.parks.map((p, i) => <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx="18" fill="#1b2a24" />)}
        <path d={`M${scenery.cx - scenery.R},${scenery.cy + 260} C${scenery.cx - 300},${scenery.cy + 120} ${scenery.cx + 100},${scenery.cy + 520} ${scenery.cx + scenery.R},${scenery.cy + 330}`} stroke="#172539" strokeWidth="46" fill="none" />
        <path d={scenery.minor.join(' ')} stroke="#262d3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" fill="none" />
        <path
          d={`M${scenery.cx - scenery.R},${scenery.cy - 140} L${scenery.cx + scenery.R},${scenery.cy + 60} M${scenery.cx - 180},${scenery.cy - scenery.R} L${scenery.cx + 60},${scenery.cy + scenery.R}`}
          stroke="#343c4c"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
        {routes?.map((r, i) =>
          i === selected ? null : (
            <polyline
              key={i}
              points={pts(paths[i])}
              className="mock-map-alt"
              stroke={ALT_ROUTE_COLOR}
              onClick={() => onSelect(i)}
              onMouseEnter={() => setTip(`${fmtMin(r.seconds)} · ${kmText(r.meters)} · tap to use`)}
              onMouseLeave={() => setTip(null)}
            />
          ),
        )}
        {sel && (
          <g onMouseEnter={() => setTip(`${fmtMin(sel.seconds)} · ${kmText(sel.meters)}`)} onMouseLeave={() => setTip(null)}>
            <polyline points={pts(selPath)} className="mock-map-casing" />
            <polyline points={pts(selPath)} className="mock-map-route" stroke={SPEED_COLORS.NORMAL} />
            {sel.intervals.map((iv, i) =>
              iv.speed === 'NORMAL' ? null : <polyline key={i} points={pts(selPath.slice(iv.start, (iv.end ?? selPath.length - 1) + 1))} className="mock-map-route" stroke={SPEED_COLORS[iv.speed]} />,
            )}
          </g>
        )}
        {origin && <Marker at={P(origin)} label="A" scale={vb[2] / 900} />}
        {dest && <Marker at={P(dest)} label="B" scale={vb[2] / 900} />}
      </svg>
      <div className="mock-map-badge">Mock map</div>
      {tip && <div className="commute-tip">{tip}</div>}
    </div>
  );
}

function Marker({ at, label, scale }: { at: readonly [number, number]; label: string; scale: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]}) scale(${scale})`}>
      <path d="M0 0 C-14 -20 -16 -26 -16 -34 A16 16 0 1 1 16 -34 C16 -26 14 -20 0 0 Z" fill="#ea4335" stroke="#8a1c13" strokeWidth="1.5" />
      <text y="-28" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">{label}</text>
    </g>
  );
}

function MockPlaceSearch({ config, onPlace, placeholder = 'Search a destination…' }: PlaceSearchProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hits = PLACES.filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <span className="mock-search">
      <input ref={input} className="commute-input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <span className="mock-search-list">
          {hits.map((p) => (
            <button
              key={p.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPlace({ label: p.label, full: `${p.label}, Old Town`, latLng: { lat: config.origin.lat + p.d[0], lng: config.origin.lng + p.d[1] } });
                setQ('');
                setOpen(false);
                input.current?.blur();
              }}
            >
              {p.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function installMockCommute() {
  setRoutesImpl(mockRoutes);
  setCommuteViews({ MapView: MockMapView, PlaceSearch: MockPlaceSearch });
  forceCommuteWindow(commuteMock.window);
}

export function updateCommuteMock(patch: Partial<typeof commuteMock>) {
  Object.assign(commuteMock, patch);
  forceCommuteWindow(commuteMock.window);
  window.dispatchEvent(new Event(COMMUTE_TEST_EVENT));
}
