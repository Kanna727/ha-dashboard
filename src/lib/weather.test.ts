import { describe, expect, it } from 'vitest';
import { compass, conditionText, rangeBar, uvLevel, weatherExtras, type ExtraCandidate } from './weather';

describe('weather: extra sensors on the weather device', () => {
  const ents: ExtraCandidate[] = [
    { entityId: 'weather.home', deviceId: 'w' },
    { entityId: 'sensor.home_precipitation_probability', deviceId: 'w', translationKey: 'precipitation_probability' },
    { entityId: 'sensor.home_rain_rate', deviceId: 'w', deviceClass: 'precipitation_intensity' },
    { entityId: 'sensor.renamed_storms', deviceId: 'w', translationKey: 'thunderstorm_probability' },
    { entityId: 'sensor.home_weather_condition', deviceId: 'w' },
    { entityId: 'sensor.home_temperature', deviceId: 'w' },
    // Same name pattern on another device: ignored.
    { entityId: 'sensor.garden_heat_index', deviceId: 'other' },
  ];

  it('matches by translation key, entity ID suffix or device class', () => {
    expect(weatherExtras('weather.home', ents)).toEqual({
      precipitation_probability: 'sensor.home_precipitation_probability',
      precipitation_intensity: 'sensor.home_rain_rate',
      thunderstorm_probability: 'sensor.renamed_storms',
      weather_condition: 'sensor.home_weather_condition',
    });
  });

  it('finds nothing when the weather entity has no device', () => {
    expect(weatherExtras('weather.missing', ents)).toEqual({});
  });
});

describe('weather: formatting', () => {
  it('names compass points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(19)).toBe('NNE');
    expect(compass(225)).toBe('SW');
    expect(compass(355)).toBe('N');
    expect(compass(-90)).toBe('W');
  });

  it('bands the UV index', () => {
    expect(uvLevel(0).label).toBe('Low');
    expect(uvLevel(2.4).label).toBe('Low');
    expect(uvLevel(5).label).toBe('Moderate');
    expect(uvLevel(7).tone).toBe('high');
    expect(uvLevel(10.2).tone).toBe('very-high');
    expect(uvLevel(11).tone).toBe('extreme');
  });

  it('prefers the integration text, in sentence case', () => {
    expect(conditionText('rainy', 'Light rain')).toBe('Light rain');
    expect(conditionText('rainy', 'unavailable')).toBe('Rainy');
    expect(conditionText('partlycloudy')).toBe('Partly cloudy');
    expect(conditionText('lightning-rainy')).toBe('Lightning rainy');
    expect(conditionText(undefined)).toBe('');
  });

  it('places a day on the shared low–high bar', () => {
    expect(rangeBar(20, 30, 20, 30)).toEqual({ left: 0, width: 100 });
    expect(rangeBar(22, 26, 20, 30)).toEqual({ left: 20, width: 40 });
    // A day with no spread still shows a sliver.
    expect(rangeBar(25, 25, 20, 30).width).toBe(4);
  });
});
