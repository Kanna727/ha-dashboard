import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from './throttle';

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the first value at once, then the latest at most every 250 ms', () => {
    const sent: number[] = [];
    const t = createThrottle((v: number) => sent.push(v), 250);
    for (let v = 1; v <= 20; v++) {
      t.push(v);
      vi.advanceTimersByTime(40); // a drag reporting every 40 ms
    }
    expect(sent[0]).toBe(1);
    expect(sent.length).toBeLessThanOrEqual(5); // 800 ms of dragging
    vi.advanceTimersByTime(250);
    expect(sent.at(-1)).toBe(20); // the trailing send delivers the last value
  });

  it('sends the final value straight away and drops what was pending', () => {
    const sent: number[] = [];
    const t = createThrottle((v: number) => sent.push(v), 250);
    t.push(1);
    t.push(2);
    t.end(3);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1, 3]);
  });
});
