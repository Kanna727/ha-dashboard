// Free-canvas layout maths (layout/Canvas.tsx): where each card sits, moving,
// resizing and stacking. Positions are px from the canvas's top-left corner,
// at the canvas width the layout was arranged at; other screens zoom it.

export interface Box {
  x: number;
  y: number;
  w: number;
  h?: number; // unset = the card is as tall as its content
}

export interface CanvasLayout {
  width: number; // the canvas width it was arranged at, px
  boxes: Record<string, Box>;
  order: string[]; // stacking, back to front
}

export interface Edge {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
}

export const MIN_W = 200;
export const MIN_H = 120;
export const GAP = 18; // matches the column gap
const NEW_W = 360;
const NEW_H = 400; // assumed height of a content-sized card when placing a new one below it

const round = (n: number) => Math.round(n);

export function moveBox(b: Box, dx: number, dy: number): Box {
  return { ...b, x: Math.max(0, round(b.x + dx)), y: Math.max(0, round(b.y + dy)) };
}

// Drags the given edges by dx/dy. `height` is the card's current rendered
// height, used when a content-sized card gets a fixed height. The left and
// top edges stop at the canvas edge; no edge can shrink the card below the
// minimum. A card stays content-sized unless the top or bottom edge moved.
export function resizeBox(b: Box, height: number, edge: Edge, dx: number, dy: number): Box {
  let { x, y, w } = b;
  let h = b.h ?? height;
  if (edge.r) w = Math.max(MIN_W, w + dx);
  if (edge.l) {
    const nw = Math.min(Math.max(MIN_W, w - dx), x + w);
    x += w - nw;
    w = nw;
  }
  if (edge.b) h = Math.max(MIN_H, h + dy);
  if (edge.t) {
    const nh = Math.min(Math.max(MIN_H, h - dy), y + h);
    y += h - nh;
    h = nh;
  }
  const out: Box = { x: round(x), y: round(y), w: round(w) };
  if (edge.t || edge.b) out.h = round(h);
  else if (b.h !== undefined) out.h = b.h;
  return out;
}

export function toFront(order: string[], id: string): string[] {
  return order[order.length - 1] === id ? order : [...order.filter((o) => o !== id), id];
}

// Far right and bottom edges of all cards; `height` gives a card's rendered height.
export function extent(layout: Pick<CanvasLayout, 'boxes'>, height: (id: string) => number): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [id, b] of Object.entries(layout.boxes)) {
    w = Math.max(w, b.x + b.w);
    h = Math.max(h, b.y + (b.h ?? height(id)));
  }
  return { w, h };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readBox(v: unknown): Box | null {
  if (!v || typeof v !== 'object') return null;
  const { x, y, w, h } = v as Record<string, unknown>;
  if (!isNum(x) || !isNum(y) || !isNum(w)) return null;
  const box: Box = { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(MIN_W, w) };
  if (isNum(h)) box.h = Math.max(MIN_H, h);
  return box;
}

export const overlapsX = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;

// Stacks the cards with a constant gap: in order of their tops (then left
// edges), each card sits GAP below the lowest card above it that it overlaps
// sideways, or at the top. Only y changes, so when a card grows or shrinks
// the cards under it move with it. `height` gives a content-sized card's height.
export function stack(boxes: Record<string, Box>, height: (id: string) => number): Record<string, Box> {
  const ids = Object.keys(boxes).sort((a, b) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x);
  const out: Record<string, Box> = {};
  const placed: { box: Box; bottom: number }[] = [];
  for (const id of ids) {
    const b = boxes[id];
    let y = 0;
    for (const p of placed) if (overlapsX(b, p.box)) y = Math.max(y, p.bottom + GAP);
    const box = b.y === y ? b : { ...b, y };
    out[id] = box;
    placed.push({ box, bottom: y + (b.h ?? height(id)) });
  }
  return out;
}

export const SNAP = 16; // screen px within which an edge snaps

// Where a card's left and right edges may snap: the canvas edges, a
// neighbour's edges (aligned) and a gap away from them (side by side).
function snapTargets(others: Box[], width: number) {
  return {
    lefts: [0, ...others.flatMap((o) => [o.x, o.x + o.w + GAP])],
    rights: [width, ...others.flatMap((o) => [o.x + o.w, o.x - GAP])],
  };
}

function nearest(v: number, targets: number[], range: number): number | null {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= range && (best === null || Math.abs(t - v) < Math.abs(best))) best = t - v;
  return best;
}

// A moved card's nearer edge pulled onto a snap target within `range` (layout px).
export function snapMove(b: Box, others: Box[], width: number, range: number): Box {
  const { lefts, rights } = snapTargets(others, width);
  const dl = nearest(b.x, lefts, range);
  const dr = nearest(b.x + b.w, rights, range);
  const d = dl === null ? dr : dr === null || Math.abs(dl) <= Math.abs(dr) ? dl : dr;
  return d === null || d === 0 ? b : { ...b, x: Math.max(0, b.x + d) };
}

// The dragged side edge of a resized card pulled onto a snap target.
export function snapResize(b: Box, edge: Edge, others: Box[], width: number, range: number): Box {
  const { lefts, rights } = snapTargets(others, width);
  if (edge.r) {
    const d = nearest(b.x + b.w, rights, range);
    if (d && b.w + d >= MIN_W) b = { ...b, w: b.w + d };
  }
  if (edge.l) {
    const d = nearest(b.x, lefts, range);
    if (d && b.w - d >= MIN_W && b.x + d >= 0) b = { ...b, x: b.x + d, w: b.w - d };
  }
  return b;
}

// How much a screen whose canvas is `width` px wide scales the layout. Within
// 2 % it stays at 1, so a page scrollbar coming and going doesn't rescale every card.
export function canvasZoom(width: number, layout: Pick<CanvasLayout, 'width'>): number {
  if (width <= 0 || layout.width <= 0) return 1;
  const z = Math.round((width / layout.width) * 1000) / 1000;
  return Math.abs(z - 1) < 0.02 ? 1 : z;
}

// A saved layout for these cards (the object stored in HA, or a JSON string),
// or null if there is none or it can't be read. Layouts saved before they had
// a width get `fallbackWidth` (the canvas they were made on). Cards it doesn't
// know (added to the dashboard since it was saved) go below everything else;
// cards that no longer exist are dropped.
export function parseLayout(raw: unknown, ids: string[], fallbackWidth = 0): CanvasLayout | null {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const src = (data as { boxes?: unknown }).boxes;
  if (!src || typeof src !== 'object') return null;
  const boxes: Record<string, Box> = {};
  for (const id of ids) {
    const b = readBox((src as Record<string, unknown>)[id]);
    if (b) boxes[id] = b;
  }
  if (Object.keys(boxes).length === 0) return null;
  const saved = (data as { order?: unknown }).order;
  const order = (Array.isArray(saved) ? saved : []).filter((id): id is string => typeof id === 'string' && id in boxes);
  for (const id of ids) if (id in boxes && !order.includes(id)) order.unshift(id);
  let bottom = extent({ boxes }, () => NEW_H).h;
  for (const id of ids) {
    if (id in boxes) continue;
    boxes[id] = { x: 0, y: bottom + GAP, w: NEW_W };
    bottom += GAP + NEW_H;
    order.push(id);
  }
  const w = (data as { width?: unknown }).width;
  const width = isNum(w) && w > 0 ? w : fallbackWidth > 0 ? fallbackWidth : extent({ boxes }, () => 0).w;
  return { width: Math.round(width), boxes, order };
}
