import { describe, expect, it } from 'vitest';
import { idleHomeStep, type IdleInput } from './idleHome';

const base: IdleInput = { page: 'energy', idleMs: 3 * 60_000, minutes: 2, modalOpen: false, busy: false, vacuumRunning: false };

describe('idleHomeStep', () => {
  it('goes home once the screen has been left alone long enough', () => {
    expect(idleHomeStep(base)).toEqual({ close: false, home: true });
    expect(idleHomeStep({ ...base, idleMs: 60_000 })).toEqual({ close: false, home: false });
  });
  it('closes a popup left open, on Home too', () => {
    expect(idleHomeStep({ ...base, modalOpen: true })).toEqual({ close: true, home: true });
    expect(idleHomeStep({ ...base, page: 'home', modalOpen: true })).toEqual({ close: true, home: false });
  });
  it('leaves a sheet, arranging and a running vacuum alone', () => {
    expect(idleHomeStep({ ...base, busy: true, modalOpen: true })).toEqual({ close: false, home: false });
    expect(idleHomeStep({ ...base, page: 'clean', vacuumRunning: true })).toEqual({ close: false, home: false });
    expect(idleHomeStep({ ...base, page: 'clean' })).toEqual({ close: false, home: true });
  });
  it('is off at 0 minutes', () => {
    expect(idleHomeStep({ ...base, minutes: 0, idleMs: 1e9 })).toEqual({ close: false, home: false });
  });
});
