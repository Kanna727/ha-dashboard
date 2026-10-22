import { describe, expect, it } from 'vitest';
import { dragOffset, lockAxis, releaseDir, settleMs, stepPage } from './swipe';

describe('lockAxis', () => {
  it('waits, then picks the main direction', () => {
    expect(lockAxis(4, 3)).toBeNull();
    expect(lockAxis(12, 3)).toBe('x');
    expect(lockAxis(-12, 6)).toBe('x');
    expect(lockAxis(8, 9)).toBe('y');
    expect(lockAxis(11, 10)).toBe('y'); // too diagonal for a page swipe
  });
});

describe('dragOffset', () => {
  it('follows the finger, stretching where there is no page', () => {
    expect(dragOffset(-120, true, true)).toBe(-120);
    expect(dragOffset(-120, true, false)).toBe(-30);
    expect(dragOffset(80, false, true)).toBe(20);
  });
});

describe('releaseDir', () => {
  const W = 1000;
  it('turns the page past 30 % or on a flick', () => {
    expect(releaseDir(-320, -0.1, W, true, true)).toBe(1);
    expect(releaseDir(310, 0.05, W, true, true)).toBe(-1);
    expect(releaseDir(-60, -0.6, W, true, true)).toBe(1); // short, fast flick
  });

  it('springs back otherwise', () => {
    expect(releaseDir(-200, -0.1, W, true, true)).toBe(0); // slow, not far enough
    expect(releaseDir(-500, 0.5, W, true, true)).toBe(0); // flicked back
    expect(releaseDir(-10, -0.8, W, true, true)).toBe(0); // a twitch
    expect(releaseDir(-600, -1, W, true, false)).toBe(0); // no next page
    expect(releaseDir(0, 0, W, true, true)).toBe(0);
  });
});

describe('settleMs', () => {
  it('matches the finger speed within limits', () => {
    expect(settleMs(700, 2.8)).toBe(250);
    expect(settleMs(700, 0.1)).toBe(360); // slow drag: capped
    expect(settleMs(50, 3)).toBe(140); // nearly there: a short floor
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
