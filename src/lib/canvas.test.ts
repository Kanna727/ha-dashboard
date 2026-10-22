import { describe, expect, it } from 'vitest';
import { GAP, MIN_H, MIN_W, canvasZoom, extent, moveBox, parseLayout, resizeBox, snapMove, snapResize, stack, toFront } from './canvas';

describe('moveBox', () => {
  it('moves by whole pixels and stops at the canvas edge', () => {
    expect(moveBox({ x: 100, y: 50, w: 300 }, 20.4, -10.6)).toEqual({ x: 120, y: 39, w: 300 });
    expect(moveBox({ x: 10, y: 10, w: 300, h: 200 }, -50, -50)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe('resizeBox', () => {
  it('right and bottom edges grow the card; height becomes fixed', () => {
    expect(resizeBox({ x: 0, y: 0, w: 300 }, 250, { r: true, b: true }, 40, 30)).toEqual({ x: 0, y: 0, w: 340, h: 280 });
  });

  it('a width-only resize keeps a content-sized card content-sized', () => {
    expect(resizeBox({ x: 0, y: 0, w: 300 }, 250, { r: true }, 40, 30)).toEqual({ x: 0, y: 0, w: 340 });
    expect(resizeBox({ x: 0, y: 0, w: 300, h: 500 }, 500, { r: true }, 40, 30)).toEqual({ x: 0, y: 0, w: 340, h: 500 });
  });

  it('left and top edges move the corner and keep the opposite edge', () => {
    expect(resizeBox({ x: 100, y: 100, w: 300, h: 300 }, 300, { l: true, t: true }, -50, 40)).toEqual({ x: 50, y: 140, w: 350, h: 260 });
  });

  it('never shrinks below the minimum or past the canvas edge', () => {
    expect(resizeBox({ x: 100, y: 100, w: 300, h: 300 }, 300, { r: true, b: true }, -1000, -1000)).toEqual({ x: 100, y: 100, w: MIN_W, h: MIN_H });
    const shrunk = resizeBox({ x: 100, y: 100, w: 300, h: 300 }, 300, { l: true, t: true }, 1000, 1000);
    expect(shrunk).toEqual({ x: 100 + 300 - MIN_W, y: 100 + 300 - MIN_H, w: MIN_W, h: MIN_H });
    expect(resizeBox({ x: 30, y: 20, w: 300, h: 300 }, 300, { l: true, t: true }, -100, -100)).toEqual({ x: 0, y: 0, w: 330, h: 320 });
  });
});

describe('toFront', () => {
  it('moves a card to the end of the stacking order', () => {
    expect(toFront(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    const same = ['a', 'b'];
    expect(toFront(same, 'b')).toBe(same);
  });
});

describe('extent', () => {
  it('uses the rendered height for content-sized cards', () => {
    const layout = { width: 900, boxes: { a: { x: 0, y: 0, w: 300, h: 200 }, b: { x: 400, y: 100, w: 500 } }, order: ['a', 'b'] };
    expect(extent(layout, () => 350)).toEqual({ w: 900, h: 450 });
  });
});

describe('parseLayout', () => {
  const ids = ['energy', 'rooms', 'car'];

  it('returns null for nothing, junk, or no usable cards', () => {
    expect(parseLayout(null, ids)).toBeNull();
    expect(parseLayout('{oops', ids)).toBeNull();
    expect(parseLayout('[]', ids)).toBeNull();
    expect(parseLayout(JSON.stringify({ boxes: { gone: { x: 0, y: 0, w: 300 } } }), ids)).toBeNull();
  });

  it('keeps known cards, clamps bad sizes and drops cards that no longer exist', () => {
    const raw = JSON.stringify({
      boxes: { energy: { x: -5, y: 10, w: 50, h: 20 }, rooms: { x: 400, y: 0, w: 500 }, car: { x: 0, y: 600, w: 300, h: 200 }, gone: { x: 0, y: 0, w: 300 } },
      order: ['car', 'gone', 'energy', 'rooms'],
    });
    expect(parseLayout(raw, ids)).toEqual({
      width: 900,
      boxes: { energy: { x: 0, y: 10, w: MIN_W, h: MIN_H }, rooms: { x: 400, y: 0, w: 500 }, car: { x: 0, y: 600, w: 300, h: 200 } },
      order: ['car', 'energy', 'rooms'],
    });
  });

  it('places a card it has never seen below everything else, in front', () => {
    const raw = JSON.stringify({ boxes: { energy: { x: 0, y: 0, w: 300, h: 300 }, rooms: { x: 400, y: 0, w: 500, h: 700 } }, order: ['rooms', 'energy'] });
    const out = parseLayout(raw, ids)!;
    expect(out.boxes.car).toEqual({ x: 0, y: 718, w: 360 });
    expect(out.order).toEqual(['rooms', 'energy', 'car']);
  });

  it('reads the object stored in HA and keeps its width', () => {
    const data = { width: 1880, boxes: { rooms: { x: 400, y: 0, w: 500 } }, order: ['rooms'] };
    expect(parseLayout(data, ids)?.width).toBe(1880);
    expect(parseLayout({}, ids)).toBeNull();
  });

  it('gives a layout saved without a width the canvas it was made on', () => {
    const raw = JSON.stringify({ boxes: { rooms: { x: 400, y: 0, w: 500 } } });
    expect(parseLayout(raw, ids, 1140)?.width).toBe(1140);
  });
});

describe('canvasZoom', () => {
  it('scales a layout to the screen it is shown on', () => {
    expect(canvasZoom(1140, { width: 1880 })).toBe(0.606);
    expect(canvasZoom(1880, { width: 1880 })).toBe(1);
    expect(canvasZoom(0, { width: 1880 })).toBe(1);
    expect(canvasZoom(1880, { width: 1865 })).toBe(1); // a scrollbar's worth
    expect(canvasZoom(1960, { width: 1865 })).toBe(1.051);
  });
});

describe('stack', () => {
  const heights: Record<string, number> = { a: 300, b: 200, c: 100, wide: 150 };
  const h = (id: string) => heights[id];

  it('keeps one gap between cards in a column, starting at the top', () => {
    const out = stack({ a: { x: 0, y: 40, w: 300 }, b: { x: 0, y: 500, w: 300 }, c: { x: 50, y: 900, w: 300 } }, h);
    expect([out.a.y, out.b.y, out.c.y]).toEqual([0, 300 + GAP, 300 + GAP + 200 + GAP]);
  });

  it('moves the cards below when a card grows, and back up when it shrinks', () => {
    const boxes = { a: { x: 0, y: 0, w: 300 }, b: { x: 0, y: 318, w: 300 } };
    expect(stack(boxes, (id) => (id === 'a' ? 420 : 200)).b.y).toBe(420 + GAP);
    expect(stack(boxes, (id) => (id === 'a' ? 120 : 200)).b.y).toBe(120 + GAP);
  });

  it('uses a fixed height over the rendered one', () => {
    expect(stack({ a: { x: 0, y: 0, w: 300, h: 500 }, b: { x: 0, y: 10, w: 300 } }, h).b.y).toBe(500 + GAP);
  });

  it('cards side by side do not push each other; a wide card goes under both', () => {
    const out = stack({ a: { x: 0, y: 0, w: 300 }, b: { x: 318, y: 0, w: 300 }, wide: { x: 100, y: 400, w: 400 } }, h);
    expect([out.a.y, out.b.y]).toEqual([0, 0]);
    expect(out.wide.y).toBe(300 + GAP); // below the taller of the two
  });

  it('a card dropped above another goes before it', () => {
    const out = stack({ a: { x: 0, y: 0, w: 300 }, b: { x: 0, y: 318, w: 300 }, c: { x: 0, y: 200, w: 300 } }, h);
    expect([out.a.y, out.c.y, out.b.y]).toEqual([0, 300 + GAP, 300 + GAP + 100 + GAP]);
  });
});

describe('snapping', () => {
  const others = [{ x: 0, y: 0, w: 300 }];

  it('pulls a moved card a gap away from its neighbour, or onto the canvas edge', () => {
    expect(snapMove({ x: 330, y: 0, w: 200 }, others, 1000, 16).x).toBe(300 + GAP);
    expect(snapMove({ x: 790, y: 0, w: 200 }, others, 1000, 16).x).toBe(800);
    expect(snapMove({ x: 400, y: 0, w: 200 }, others, 1000, 16).x).toBe(400); // nothing near
  });

  it('pulls a resized edge onto a target, never below the minimum width', () => {
    expect(snapResize({ x: 600, y: 0, w: 390 }, { r: true }, others, 1000, 16).w).toBe(400);
    expect(snapResize({ x: 330, y: 0, w: 300 }, { l: true }, others, 1000, 16)).toEqual({ x: 318, y: 0, w: 312 });
  });
});
