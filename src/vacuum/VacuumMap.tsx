import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import {
  lineLength,
  moveLine,
  moveLineEnd,
  moveRect,
  normRect,
  rectArea,
  rectCorners,
  resizeRect,
  roomAt,
  type Calibration,
  type Line,
  type Pt,
  type Rect,
  type VacRoom,
} from '../lib/vacuum';
import type { MapImage } from './useMapImage';

export type ShapeKind = 'zone' | 'noGo' | 'noMop' | 'wall' | 'split';

export interface Shape {
  id: string;
  kind: ShapeKind;
  rect?: Rect;
  line?: Line;
  label?: string;
  editable?: boolean;
}

export interface MapProps {
  map: MapImage | null;
  cal: Calibration | null;
  rooms: VacRoom[];
  robot?: Pt & { a?: number };
  dock?: Pt;
  running?: boolean;
  // Room selection (badges show the order rooms were picked in).
  selected?: number[];
  dimOthers?: boolean;
  onRoomTap?: (id: number) => void;
  // Shapes drawn over the map; editable ones can be selected, moved, resized and deleted.
  shapes: Shape[];
  active?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (shape: Shape) => void;
  onDelete?: (id: string) => void;
  // What a drag on an empty part of the map draws (else it pans).
  draw?: { kind: ShapeKind; shape: 'rect' | 'line' } | null;
  onDraw?: (shape: Shape) => void;
  // Spot / go-to point.
  point?: Pt | null;
  onPoint?: (p: Pt) => void;
  // Space overlays cover (px from each edge): the map fits and centres inside the rest.
  pad?: { t: number; r: number; b: number; l: number };
}

interface View {
  s: number; // zoom
  x: number; // pan, container px
  y: number;
}

type Gesture =
  | { kind: 'pending'; sx: number; sy: number; start: Pt; view: View; del?: string }
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'draw'; start: Pt }
  | { kind: 'move'; id: string; start: Pt; orig: Shape; moved: boolean }
  | { kind: 'handle'; id: string; handle: number; orig: Shape }
  | { kind: 'pinch'; dist: number; mid: { x: number; y: number }; view: View };

const MIN_S = 1;
const MAX_S = 8;
const FOLLOW_S = 2.5; // zoom while following the robot: a room or two across
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const COLORS: Record<ShapeKind, string> = {
  zone: 'var(--accent)',
  noGo: 'var(--danger)',
  noMop: 'var(--accent-fan)',
  wall: 'var(--danger)',
  split: '#fff',
};

export function VacuumMap(props: MapProps) {
  const { map, cal, rooms, shapes, active, draw, point, selected = [] } = props;
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const mask = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // The shape being drawn or dragged. Mirrored in a ref: a release can arrive
  // before React has rendered the last move, and must still see that shape.
  const [preview, setPreviewState] = useState<Shape | null>(null);
  const previewRef = useRef<Shape | null>(null);
  const setPreview = (s: Shape | null) => {
    previewRef.current = s;
    setPreviewState(s);
  };
  const propsRef = useRef(props);
  propsRef.current = props;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The image fitted inside the box at zoom 1 (inside `pad`, the room overlays take).
  const pad = props.pad ?? { t: 0, r: 0, b: 0, l: 0 };
  const aw = Math.max(1, size.w - pad.l - pad.r);
  const ah = Math.max(1, size.h - pad.t - pad.b);
  const iw = map?.w ?? 1;
  const ih = map?.h ?? 1;
  const fit = Math.min(aw / iw, ah / ih) || 1;
  const fw = iw * fit;
  const fh = ih * fit;
  const left = pad.l + (aw - fw) / 2;
  const top = pad.t + (ah - fh) / 2;
  const k = 1 / (fit * view.s); // image px per screen px: keeps handles and strokes finger-sized

  const clampView = (v: View): View => {
    const s = clamp(v.s, MIN_S, MAX_S);
    // Keep the map's centre on screen.
    const cx = clamp(left + v.x + (s * fw) / 2, 0, size.w) - left - (s * fw) / 2;
    const cy = clamp(top + v.y + (s * fh) / 2, 0, size.h) - top - (s * fh) / 2;
    return { s, x: cx, y: cy };
  };
  const zoomAt = (from: View, s: number, cx: number, cy: number): View => {
    const px = (cx - left - from.x) / from.s;
    const py = (cy - top - from.y) / from.s;
    const ns = clamp(s, MIN_S, MAX_S);
    return clampView({ s: ns, x: cx - left - ns * px, y: cy - top - ns * py });
  };

  /* ---------- following the robot ----------
     While it runs, the map zooms in and keeps the robot centred, gliding as its
     position updates (the map stays filling the box near its edges). Panning or
     pinching hands control back; the follow button resumes; when the run ends
     the map glides back to the whole view. */
  const [following, setFollowing] = useState(true);
  const [followS, setFollowS] = useState(FOLLOW_S);
  const [glide, setGlide] = useState(false); // animate programmatic view changes only
  const canFollow = !!props.running && !!props.robot && !!cal && !!map;
  const followOn = canFollow && following;
  const userView = (v: View) => {
    setGlide(false);
    setView(v);
  };
  const stopFollowing = () => followOn && setFollowing(false);
  // Pan so a stage point (fitted px) is centred, without showing past the map's edges when zoomed in.
  const centreOn = (s: number, px: number, py: number): View => {
    // `mid`: the centre of the clear area (inside `pad`).
    const axis = (box: number, mid: number, off: number, len: number, p: number) =>
      s * len >= box ? clamp(mid - off - s * p, box - off - s * len, -off) : mid - off - (s * len) / 2;
    return { s, x: axis(size.w, pad.l + aw / 2, left, fw, px), y: axis(size.h, pad.t + ah / 2, top, fh, py) };
  };
  const robotKey = props.robot ? `${Math.round(props.robot.x)},${Math.round(props.robot.y)}` : '';
  useEffect(() => {
    if (!followOn || !size.w) return;
    const ip = cal!.toImg(props.robot!);
    setGlide(true);
    setView(centreOn(followS, ip.x * fit, ip.y * fit));
  }, [followOn, robotKey, followS, size.w, size.h, map?.w, map?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  // Run over: back to the whole map, and follow again next time.
  const wasRunning = useRef(!!props.running);
  useEffect(() => {
    if (wasRunning.current && !props.running) {
      setGlide(true);
      setView({ s: 1, x: 0, y: 0 });
      setFollowing(true);
      setFollowS(FOLLOW_S);
    }
    wasRunning.current = !!props.running;
  }, [props.running]);
  const zoomFollow = (f: number) => setFollowS((s) => clamp(s * f, MIN_S, MAX_S));

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.pow(1.0015, -e.deltaY);
      if (followOn) return zoomFollow(f); // zoom stays centred on the robot
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      userView(zoomAt(v, v.s * f, e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Paint selected rooms (and dim the rest) from the pixel labels.
  useEffect(() => {
    const c = mask.current;
    if (!c || !map) return;
    c.width = map.w;
    c.height = map.h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, map.w, map.h);
    if (!map.labels || (!selected.length && !props.dimOthers)) return;
    const pick = new Set(selected.map((id) => map.rooms.findIndex((r) => r.id === id) + 1).filter((i) => i > 0));
    const img = ctx.createImageData(map.w, map.h);
    const d = img.data;
    const L = map.labels;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!l) continue;
      const j = i * 4;
      if (pick.has(l)) {
        d[j] = 139; d[j + 1] = 124; d[j + 2] = 246; d[j + 3] = 150;
      } else if (pick.size || props.dimOthers) {
        d[j] = 7; d[j + 1] = 9; d[j + 2] = 15; d[j + 3] = 120;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [map, selected.join(','), props.dimOthers]); // eslint-disable-line react-hooks/exhaustive-deps

  const toImg = (p: Pt) => (cal ? cal.toImg(p) : p);
  const vacAt = (clientX: number, clientY: number): Pt | null => {
    const el = stage.current;
    if (!el || !cal || !map) return null;
    const r = el.getBoundingClientRect();
    return cal.toVac({ x: ((clientX - r.left) / r.width) * map.w, y: ((clientY - r.top) / r.height) * map.h });
  };
  const colourMatch = (p: Pt) => {
    if (!map?.labels || !cal) return undefined;
    const ip = cal.toImg(p);
    const l = map.labels[Math.round(ip.y) * map.w + Math.round(ip.x)];
    return l ? (room: VacRoom) => map.rooms[l - 1]?.id === room.id : undefined;
  };

  const shapeById = (id: string) => (previewRef.current?.id === id ? previewRef.current : shapes.find((s) => s.id === id));

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('.vmap-tools')) return;
    box.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = box.current!.getBoundingClientRect();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setPreview(null);
      stopFollowing();
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, view: viewRef.current };
      return;
    }
    if (pointers.current.size > 2) return;
    const p = vacAt(e.clientX, e.clientY);
    const t = e.target as Element;
    const handle = t.closest('[data-handle]') as HTMLElement | SVGElement | null;
    const del = t.closest('[data-delete]')?.getAttribute('data-delete') ?? undefined;
    const body = t.closest('[data-shape]')?.getAttribute('data-shape');
    if (handle && p) {
      const id = handle.getAttribute('data-shape-id')!;
      const orig = shapeById(id);
      if (orig) gesture.current = { kind: 'handle', id, handle: Number(handle.getAttribute('data-handle')), orig };
      return;
    }
    if (body && p && !del) {
      const orig = shapeById(body);
      if (orig?.editable) {
        if (propsRef.current.active !== body) propsRef.current.onSelect?.(body);
        gesture.current = { kind: 'move', id: body, start: p, orig, moved: false };
        return;
      }
    }
    gesture.current = { kind: 'pending', sx: e.clientX, sy: e.clientY, start: p ?? { x: 0, y: 0 }, view: viewRef.current, del };
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const r = box.current!.getBoundingClientRect();
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const z = zoomAt(g.view, g.view.s * (dist / g.dist), g.mid.x, g.mid.y);
      userView(clampView({ s: z.s, x: z.x + mid.x - g.mid.x, y: z.y + mid.y - g.mid.y }));
      return;
    }
    if (g.kind === 'pending') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 7) return;
      const d = propsRef.current.draw;
      gesture.current = d && !g.del ? { kind: 'draw', start: g.start } : { kind: 'pan', sx: g.sx, sy: g.sy, view: viewRef.current };
      if (gesture.current.kind === 'pan') {
        stopFollowing(); // looking around: stop chasing the robot
        gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current };
      }
      return onMove(e);
    }
    if (g.kind === 'pan') {
      userView(clampView({ s: g.view.s, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy }));
      return;
    }
    const p = vacAt(e.clientX, e.clientY);
    if (!p) return;
    if (g.kind === 'draw') {
      const d = propsRef.current.draw!;
      setPreview(
        d.shape === 'rect'
          ? { id: '__new', kind: d.kind, rect: normRect(g.start, p), editable: true }
          : { id: '__new', kind: d.kind, line: [g.start.x, g.start.y, p.x, p.y], editable: true },
      );
    } else if (g.kind === 'move') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      g.moved = true;
      setPreview({ ...g.orig, rect: g.orig.rect && moveRect(g.orig.rect, dx, dy), line: g.orig.line && moveLine(g.orig.line, dx, dy) });
    } else if (g.kind === 'handle') {
      setPreview({
        ...g.orig,
        rect: g.orig.rect && resizeRect(g.orig.rect, g.handle, p),
        line: g.orig.line && moveLineEnd(g.orig.line, g.handle as 0 | 1, p),
      });
    }
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      gesture.current = null; // the finger left behind doesn't start a pan
      return;
    }
    gesture.current = null;
    const P = propsRef.current;
    if (!g) return;
    if (g.kind === 'pending') {
      if (g.del) return P.onDelete?.(g.del);
      const p = vacAt(e.clientX, e.clientY);
      if (!p) return;
      if (P.onPoint) return P.onPoint(p);
      if (P.active) P.onSelect?.(null);
      if (P.onRoomTap) {
        const room = roomAt(p, P.rooms, colourMatch(p));
        if (room) P.onRoomTap(room.id);
      }
      return;
    }
    const shape = previewRef.current;
    setPreview(null);
    if (!shape) return;
    if (g.kind === 'draw') {
      // Ignore slips: at least 0.3 m across (zones) or long (lines).
      const big = shape.rect ? shape.rect[2] - shape.rect[0] > 300 && shape.rect[3] - shape.rect[1] > 300 : shape.line ? lineLength(shape.line) > 0.3 : false;
      if (big) P.onDraw?.(shape);
    } else if ((g.kind === 'move' && g.moved) || g.kind === 'handle') {
      P.onChange?.(shape);
    }
  };

  const onCancel = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setPreview(null);
  };

  const zoomBy = (f: number) => (followOn ? zoomFollow(f) : userView(zoomAt(view, view.s * f, size.w / 2, size.h / 2)));

  const drawn = preview ? [...shapes.filter((s) => s.id !== preview.id), preview] : shapes;
  const poly = (r: Rect) => rectCorners(r).map((c) => toImg(c)).map((c) => `${c.x},${c.y}`).join(' ');

  const renderShape = (s: Shape) => {
    const color = COLORS[s.kind];
    const isActive = s.id === active || s.id === preview?.id;
    const common = { 'data-shape': s.editable ? s.id : undefined, className: `vshape ${s.kind} ${isActive ? 'active' : ''} ${s.editable ? 'editable' : ''}` };
    if (s.rect) {
      const corners = rectCorners(s.rect).map(toImg);
      const tr = corners.reduce((a, c) => (c.x - c.y > a.x - a.y ? c : a)); // top-right on screen
      const cx = corners.reduce((a, c) => a + c.x, 0) / 4;
      const cy = corners.reduce((a, c) => a + c.y, 0) / 4;
      return (
        <g key={s.id} {...common} style={{ ['--c' as string]: color }}>
          <polygon points={poly(s.rect)} strokeWidth={2 * k} strokeDasharray={s.kind === 'noMop' ? `${6 * k} ${4 * k}` : undefined} />
          {(s.label || isActive) && (
            <text x={cx} y={cy} fontSize={12 * k} textAnchor="middle" dominantBaseline="middle">
              {s.label ?? ''}
              {isActive && <tspan x={cx} dy={15 * k} fontSize={10 * k}>{rectArea(s.rect).toFixed(1)} m²</tspan>}
            </text>
          )}
          {isActive && s.editable && (
            <>
              {corners.map((c, i) => (
                <circle key={i} className="vhandle" data-handle={i} data-shape-id={s.id} cx={c.x} cy={c.y} r={11 * k} strokeWidth={2 * k} />
              ))}
              {s.id !== '__new' && <DeleteBubble id={s.id} at={tr} k={k} />}
            </>
          )}
        </g>
      );
    }
    if (s.line) {
      const a = toImg({ x: s.line[0], y: s.line[1] });
      const b = toImg({ x: s.line[2], y: s.line[3] });
      return (
        <g key={s.id} {...common} style={{ ['--c' as string]: color }}>
          <line className="vhit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={22 * k} />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={(s.kind === 'wall' ? 4 : 3) * k} strokeDasharray={s.kind === 'split' ? `${8 * k} ${5 * k}` : undefined} strokeLinecap="round" />
          {isActive && s.editable && (
            <>
              {[a, b].map((c, i) => (
                <circle key={i} className="vhandle" data-handle={i} data-shape-id={s.id} cx={c.x} cy={c.y} r={11 * k} strokeWidth={2 * k} />
              ))}
              {s.id !== '__new' && <DeleteBubble id={s.id} at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 22 * k }} k={k} />}
            </>
          )}
        </g>
      );
    }
    return null;
  };

  const robot = props.robot && cal ? toImg(props.robot) : null;
  const pin = point && cal ? toImg(point) : null;

  return (
    <div
      ref={box}
      className={`vmap ${draw ? 'drawing' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      {!map && <div className="vmap-empty muted">{cal === null && !map ? 'Waiting for the map…' : 'Loading map…'}</div>}
      {map && (
        <div
          ref={stage}
          className={`vmap-stage ${glide ? 'glide' : ''}`}
          style={{ left, top, width: fw, height: fh, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        >
          <img src={map.url} alt="Vacuum map" draggable={false} />
          <canvas ref={mask} className="vmap-mask" />
          <svg viewBox={`0 0 ${map.w} ${map.h}`} preserveAspectRatio="none">
            {/* Without readable pixels, selected rooms are shown as their boxes. */}
            {!map.labels &&
              selected.map((id) => {
                const r = rooms.find((x) => x.id === id);
                return r ? <polygon key={id} className="vroom-box" points={poly(r.box)} strokeWidth={2 * k} /> : null;
              })}
            {drawn.map(renderShape)}
            {selected.map((id, i) => {
              const r = rooms.find((x) => x.id === id);
              if (!r || !cal) return null;
              const c = toImg(r.center);
              return (
                <g key={id} className="vbadge" transform={`translate(${c.x} ${c.y - 22 * k})`}>
                  <circle r={11 * k} />
                  <text fontSize={12 * k} textAnchor="middle" dominantBaseline="central">
                    {i + 1}
                  </text>
                </g>
              );
            })}
            {robot && props.running && <circle className="vrobot-ring" cx={robot.x} cy={robot.y} r={16 * k} strokeWidth={2 * k} />}
            {pin && (
              <g className="vpin" transform={`translate(${pin.x} ${pin.y})`}>
                <circle r={18 * k} strokeWidth={2 * k} />
                <circle r={4 * k} />
              </g>
            )}
          </svg>
        </div>
      )}
      <div className="vmap-tools">
        <button className="round small" aria-label="Zoom in" onClick={() => zoomBy(1.5)}>
          <Icon name="zoomIn" size={20} />
        </button>
        <button className="round small" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)} disabled={(followOn ? followS : view.s) <= MIN_S}>
          <Icon name="zoomOut" size={20} />
        </button>
        <button
          className="round small"
          aria-label="Fit map"
          onClick={() => {
            stopFollowing();
            setGlide(true);
            setView({ s: 1, x: 0, y: 0 });
          }}
          disabled={!followOn && view.s === 1 && !view.x && !view.y}
        >
          <Icon name="fit" size={20} />
        </button>
        {canFollow && (
          <button
            className={`round small vfollow ${following ? 'active' : ''}`}
            aria-label={following ? 'Following the robot' : 'Follow the robot'}
            aria-pressed={following}
            title={following ? 'Following the robot' : 'Follow the robot'}
            onClick={() => setFollowing(!following)}
          >
            <Icon name="navigate" size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

function DeleteBubble({ id, at, k }: { id: string; at: Pt; k: number }) {
  return (
    <g className="vdelete" data-delete={id} transform={`translate(${at.x + 16 * k} ${at.y - 16 * k})`}>
      <circle r={13 * k} />
      <path d="M-4,-4 L4,4 M4,-4 L-4,4" transform={`scale(${k * 1.1})`} strokeWidth={2.2} />
    </g>
  );
}
