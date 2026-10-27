import { describe, expect, it } from 'vitest';
import { airTone, findAirQuality, pollutantName, shortCategory } from './airQuality';

const ent = (entityId: string, translationKey?: string) => ({ entityId, deviceId: 'a', platform: 'google_air_quality', translationKey });

describe('findAirQuality', () => {
  it('finds the index, category and dominant pollutant', () => {
    const r = {
      devices: [],
      entities: [
        ent('sensor.home_uaqi_category', 'uaqi_category'),
        ent('sensor.home_universal_air_quality_index', 'uaqi'),
        ent('sensor.home_uaqi_dominant_pollutant', 'uaqi_dominant_pollutant'),
        ent('sensor.home_pm2_5', 'pm25'),
      ],
    };
    expect(findAirQuality(r)).toEqual({
      index: 'sensor.home_universal_air_quality_index',
      category: 'sensor.home_uaqi_category',
      pollutant: 'sensor.home_uaqi_dominant_pollutant',
    });
  });
  it('is undefined without the integration', () => {
    expect(findAirQuality({ devices: [], entities: [{ entityId: 'sensor.x', deviceId: 'a', platform: 'met' }] })).toBeUndefined();
  });
});

describe('air quality words', () => {
  it('tones, categories and pollutants', () => {
    expect([airTone(80), airTone(50), airTone(20)]).toEqual(['good', 'fair', 'poor']);
    expect(shortCategory('Good air quality')).toBe('Good');
    expect(pollutantName('pm25')).toBe('PM2.5');
    expect(pollutantName('o3')).toBe('Ozone');
  });
});
