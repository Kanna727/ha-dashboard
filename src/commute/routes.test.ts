import { describe, expect, it } from 'vitest';
import { extractCommuteConfig } from './routes';
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
