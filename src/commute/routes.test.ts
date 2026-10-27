import { describe, expect, it } from 'vitest';
import { decodePolyline, delayMin, extractCommuteConfig, leaveIn, speedSegments, speedShares, trafficLevel, type Route } from './routes';
import type { LovelaceConfig } from '../ha/api';

// The example config's COMMUTE.cardType is custom:commute-traffic-map.
const card = {
  type: 'custom:commute-traffic-map',
  api_key: 'test-key',
  origin_lat: 1,
  origin_lng: 2,
  dest_lat: 3,
  dest_lng: 4,
};

describe('extractCommuteConfig', () => {
  it('finds the card nested inside stacks and sections', () => {
    const lovelace = {
      views: [
        { cards: [{ type: 'entities' }] },
        { sections: [{ cards: [{ type: 'vertical-stack', cards: [{ type: 'grid', cards: [card] }] }] }] },
      ],
    } as unknown as LovelaceConfig;
    const cfg = extractCommuteConfig(lovelace);
    expect(cfg).toMatchObject({ apiKey: 'test-key', origin: { lat: 1, lng: 2 }, dest: { lat: 3, lng: 4 }, defaultVehicle: 'DRIVE' });
    expect(cfg?.center).toEqual({ lat: 2, lng: 3 });
  });

  it('returns null without a key or with bad coordinates', () => {
    expect(extractCommuteConfig({ views: [{ cards: [{ ...card, api_key: undefined }] }] } as unknown as LovelaceConfig)).toBeNull();
    expect(extractCommuteConfig({ views: [{ cards: [{ ...card, dest_lat: 'x' }] }] } as unknown as LovelaceConfig)).toBeNull();
    expect(extractCommuteConfig({ views: [] } as unknown as LovelaceConfig)).toBeNull();
  });
});

describe('decodePolyline', () => {
  it("decodes Google's documented example", () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});

// Five points one step apart along a meridian: four equal stretches.
const line = [0, 1, 2, 3, 4].map((k) => ({ lat: k * 0.01, lng: 0 }));
const route = (intervals: Route['intervals'], extra: Partial<Route> = {}): Route => ({ seconds: 1200, meters: 4000, encodedPolyline: '', intervals, ...extra });

describe('speedSegments', () => {
  it('splits the route by distance and merges repeats', () => {
    const segs = speedSegments(route([{ start: 0, end: 1, speed: 'NORMAL' }, { start: 1, end: 3, speed: 'SLOW' }, { start: 3, end: 4, speed: 'SLOW' }]), line);
    expect(segs.map((s) => s.speed)).toEqual(['NORMAL', 'SLOW']);
    expect(segs[0].to).toBeCloseTo(0.25, 3);
    expect(segs[1].to).toBeCloseTo(1, 3);
  });

  it('treats gaps between readings as normal', () => {
    const segs = speedSegments(route([{ start: 2, end: 3, speed: 'TRAFFIC_JAM' }]), line);
    expect(segs.map((s) => s.speed)).toEqual(['NORMAL', 'TRAFFIC_JAM', 'NORMAL']);
    expect(speedShares(segs).TRAFFIC_JAM).toBeCloseTo(0.25, 3);
  });

  it('copes with an empty path', () => {
    expect(speedSegments(route([]), [])).toEqual([{ from: 0, to: 1, speed: 'NORMAL' }]);
  });
});

describe('trafficLevel', () => {
  it('uses the delay over the no-traffic time when given', () => {
    expect(trafficLevel(route([], { seconds: 1260, staticSeconds: 1200 }))).toBe('light');
    expect(trafficLevel(route([], { seconds: 1500, staticSeconds: 1200 }))).toBe('moderate');
    expect(trafficLevel(route([], { seconds: 1800, staticSeconds: 1200 }))).toBe('heavy');
    expect(delayMin(route([], { seconds: 1800, staticSeconds: 1200 }))).toBe(10);
    expect(delayMin(route([]))).toBeUndefined();
  });

  it('falls back to the slow and jammed share of the route', () => {
    const r = (speed: 'SLOW' | 'TRAFFIC_JAM', end: number) => speedSegments(route([{ start: 0, end, speed }]), line);
    expect(trafficLevel(route([]), speedSegments(route([]), line))).toBe('light');
    expect(trafficLevel(route([]), r('SLOW', 1))).toBe('moderate');
    expect(trafficLevel(route([]), r('TRAFFIC_JAM', 1))).toBe('heavy');
  });
});

describe('leaveIn', () => {
  const now = new Date(2026, 9, 27, 9, 30);
  it('counts down to leaving for the arrival time', () => {
    expect(leaveIn('10:30', 40 * 60, now)).toBe(20);
    expect(leaveIn('10:00', 40 * 60, now)).toBe(-10);
  });
  it('needs a valid HH:MM', () => {
    expect(leaveIn(undefined, 600, now)).toBeUndefined();
    expect(leaveIn('half ten', 600, now)).toBeUndefined();
  });
});
