import { describe, expect, it } from 'vitest';
import { finishedAt, grimeOpacity, SHINE_MINUTES, shineEnds, smudgeOpacity } from './dishes';

describe('dish dirt', () => {
  it('fades each smudge over the 25 % before its mark', () => {
    expect(smudgeOpacity(60, 0)).toBe(1);
    expect(smudgeOpacity(60, 35)).toBe(1);
    expect(smudgeOpacity(60, 47.5)).toBeCloseTo(0.5);
    expect(smudgeOpacity(60, 60)).toBe(0);
    expect(smudgeOpacity(60, 100)).toBe(0);
  });

  it('thins the grime film to nothing by the end', () => {
    expect(grimeOpacity(0)).toBeCloseTo(0.3);
    expect(grimeOpacity(50)).toBeCloseTo(0.15);
    expect(grimeOpacity(100)).toBe(0);
    expect(grimeOpacity(120)).toBe(0);
  });
});

describe('dishwasher finish', () => {
  const t = '2026-10-12T08:36:52Z';
  const ms = Date.parse(t);

  it('takes the time the state turned "finished", or progress reached 100', () => {
    expect(finishedAt('finished', t, 100, '2026-10-12T08:36:50Z')).toBe(ms);
    expect(finishedAt('run', undefined, 100, t)).toBe(ms);
    expect(finishedAt('ready', t, 0, t)).toBeUndefined();
    expect(finishedAt('run', t, 99, t)).toBeUndefined();
    expect(finishedAt('finished', 'garbage')).toBeUndefined();
  });

  it(`shines for ${SHINE_MINUTES} minutes after the finish`, () => {
    const end = ms + SHINE_MINUTES * 60_000;
    expect(shineEnds(ms, ms, false)).toBe(end);
    expect(shineEnds(ms, end - 1, false)).toBe(end);
    expect(shineEnds(ms, end, false)).toBeUndefined();
    expect(shineEnds(ms, ms - 30_000, false)).toBe(end); // tablet clock a little behind
    expect(shineEnds(ms, ms - 5 * 60_000, false)).toBeUndefined();
  });

  it('never shines while a cycle runs or without a finish', () => {
    expect(shineEnds(ms, ms + 1000, true)).toBeUndefined();
    expect(shineEnds(undefined, ms, false)).toBeUndefined();
  });
});
