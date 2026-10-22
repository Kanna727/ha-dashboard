import { describe, expect, it } from 'vitest';
import { stepPage, swipeDir } from './swipe';

const p = (x: number, y: number, t = 0) => ({ x, y, t });

describe('swipeDir', () => {
  it('takes a quick sideways flick', () => {
    expect(swipeDir(p(600, 400), p(400, 420, 250), 1180)).toBe(1);
    expect(swipeDir(p(300, 400), p(500, 380, 250), 1180)).toBe(-1);
  });

  it('ignores short, slow, vertical and edge starts', () => {
    expect(swipeDir(p(600, 400), p(560, 400, 100), 1180)).toBe(0); // too short
    expect(swipeDir(p(600, 400), p(300, 400, 1200), 1180)).toBe(0); // too slow
    expect(swipeDir(p(600, 400), p(450, 250, 200), 1180)).toBe(0); // diagonal: scrolling
    expect(swipeDir(p(8, 400), p(300, 400, 200), 1180)).toBe(0); // from the edge
    expect(swipeDir(p(1175, 400), p(800, 400, 200), 1180)).toBe(0);
  });

  it('scales the distance with the screen', () => {
    // 12 % of a 412 px phone is 49 px, so the 70 px floor applies.
    expect(swipeDir(p(300, 400), p(240, 400, 200), 412)).toBe(0);
    expect(swipeDir(p(300, 400), p(225, 400, 200), 412)).toBe(1);
  });
});

describe('stepPage', () => {
  it('steps without wrapping', () => {
    const pages = ['home', 'energy', 'vacuum'] as const;
    expect(stepPage(pages, 'home', 1)).toBe('energy');
    expect(stepPage(pages, 'home', -1)).toBeUndefined();
    expect(stepPage(pages, 'vacuum', 1)).toBeUndefined();
    expect(stepPage(pages, 'vacuum', -1)).toBe('energy');
  });
});
