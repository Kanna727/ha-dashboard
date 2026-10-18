// A procedurally grown tree for the page sky (components/SkyBackdrop.tsx),
// swaying with the wind. Pure, unit-tested.
//
// The tree is drawn once as SVG masks (trunk, plus one per main limb with its
// branches and foliage) laid over each other in the same 300 × 400 box, so each
// limb can sway as its own composited layer without repainting anything.

export const TREE_W = 300;
export const TREE_H = 400;

// Small seeded generator (mulberry32), so the tree is the same on every load.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}
export interface Leaf {
  x: number;
  y: number;
  a: number; // rotation, degrees
  s: number; // scale
}
export interface Limb {
  base: [number, number]; // where it leaves the trunk: the pivot it sways about
  segments: Segment[];
  leaves: Leaf[];
}
export interface Tree {
  trunk: Segment[];
  limbs: Limb[];
}

const RAD = Math.PI / 180;

export function growTree(seed = 7): Tree {
  const r = rng(seed);
  const between = (a: number, b: number) => a + (b - a) * r();
  const trunk: Segment[] = [];

  // A slightly crooked trunk up to the fork.
  let x = 150;
  let y = TREE_H;
  let w = 19;
  for (let i = 0; i < 4; i++) {
    const nx = x + between(-5, 5);
    const ny = y - between(32, 40);
    trunk.push({ x1: x, y1: y, x2: nx, y2: ny, w });
    x = nx;
    y = ny;
    w *= 0.9;
  }

  // A crooked branch from (x, y) heading `angle` degrees from vertical (positive = right).
  function branch(limb: Limb, x0: number, y0: number, angle: number, len: number, width: number, depth: number) {
    let bx = x0;
    let by = y0;
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const a = (angle + between(-12, 12)) * RAD;
      const nx = bx + (Math.sin(a) * len) / steps;
      const ny = by - (Math.cos(a) * len) / steps;
      limb.segments.push({ x1: bx, y1: by, x2: nx, y2: ny, w: width * (1 - (0.35 * i) / steps) });
      bx = nx;
      by = ny;
    }
    // Foliage on the outer twigs: a loose cluster of leaves with gaps between.
    if (depth <= 2) {
      const n = [24, 13, 7][depth];
      const spread = [17, 13, 10][depth];
      for (let i = 0; i < n; i++) {
        const d = Math.sqrt(r()) * spread;
        const t = r() * 2 * Math.PI;
        limb.leaves.push({ x: bx + Math.cos(t) * d, y: by + Math.sin(t) * d * 0.8, a: between(0, 360), s: between(0.7, 1.25) });
      }
    }
    if (depth === 0) return;
    const kids = r() < 0.35 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      // Spread the children either side; outer branches droop a little under their weight.
      const side = kids === 2 ? (k === 0 ? -1 : 1) : k - 1;
      const child = angle + side * between(16, 34) + (Math.abs(angle) > 40 ? Math.sign(angle) * 6 : 0);
      branch(limb, bx, by, child, len * between(0.66, 0.8), width * 0.66, depth - 1);
    }
  }

  const limbs: Limb[] = [-40, -4, 36].map((angle) => {
    const limb: Limb = { base: [x, y], segments: [], leaves: [] };
    branch(limb, x, y, angle + between(-6, 6), between(62, 78), w * 0.72, 4);
    return limb;
  });
  return fit({ trunk, limbs });
}

// Shrink the tree about the foot of its trunk until the crown fits the box.
function fit(tree: Tree): Tree {
  const cx = TREE_W / 2;
  const pts = [...tree.trunk, ...tree.limbs.flatMap((l) => l.segments)].flatMap((s) => [
    [s.x1, s.y1],
    [s.x2, s.y2],
  ]);
  for (const l of tree.limbs) for (const leaf of l.leaves) pts.push([leaf.x, leaf.y]);
  const m = 8; // margin for leaf size
  let k = 1;
  for (const [x, y] of pts) {
    if (y < m) k = Math.min(k, (TREE_H - m) / (TREE_H - y));
    if (x < m) k = Math.min(k, (cx - m) / (cx - x));
    if (x > TREE_W - m) k = Math.min(k, (TREE_W - m - cx) / (x - cx));
  }
  if (k === 1) return tree;
  const px = (x: number) => cx + (x - cx) * k;
  const py = (y: number) => TREE_H - (TREE_H - y) * k;
  const seg = (s: Segment): Segment => ({ x1: px(s.x1), y1: py(s.y1), x2: px(s.x2), y2: py(s.y2), w: s.w * k });
  return {
    trunk: tree.trunk.map(seg),
    limbs: tree.limbs.map((l) => ({
      base: [px(l.base[0]), py(l.base[1])],
      segments: l.segments.map(seg),
      leaves: l.leaves.map((leaf) => ({ ...leaf, x: px(leaf.x), y: py(leaf.y), s: leaf.s * Math.max(k, 0.8) })),
    })),
  };
}

const f1 = (v: number) => v.toFixed(1);
const svgUri = (body: string, w = TREE_W, h = TREE_H) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;
const strokes = (segs: Segment[]) => segs.map((s) => `<path d='M${f1(s.x1)} ${f1(s.y1)}L${f1(s.x2)} ${f1(s.y2)}' stroke-width='${f1(s.w)}'/>`).join('');

// A leaf (pointed oval about 8 × 3.5) for the foliage masks.
const LEAF_SYMBOL = `<symbol id='l' overflow='visible'><path d='M0 -4C2.2 -2 2.2 2 0 4C-2.2 2 -2.2 -2 0 -4Z'/></symbol>`;

// The masks: the trunk, then each limb with its branches and leaves.
export function treeMasks(tree: Tree) {
  const g = (body: string) => `<g fill='#fff' stroke='#fff' stroke-linecap='round' stroke-linejoin='round'>${body}</g>`;
  return {
    trunk: svgUri(g(strokes(tree.trunk))),
    limbs: tree.limbs.map((limb) => ({
      origin: [(limb.base[0] / TREE_W) * 100, (limb.base[1] / TREE_H) * 100] as [number, number],
      mask: svgUri(
        `<defs>${LEAF_SYMBOL}</defs>` +
          g(strokes(limb.segments)) +
          `<g fill='#fff'>${limb.leaves.map((l) => `<use href='#l' transform='translate(${f1(l.x)} ${f1(l.y)}) rotate(${Math.round(l.a)}) scale(${l.s.toFixed(2)})'/>`).join('')}</g>`,
      ),
    })),
  };
}
