import { describe, expect, it } from 'vitest';
import { MIN_H, MIN_W, extent, moveBox, parseLayout, resizeBox, toFront } from './canvas';

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
    const layout = { boxes: { a: { x: 0, y: 0, w: 300, h: 200 }, b: { x: 400, y: 100, w: 500 } }, order: ['a', 'b'] };
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
});
