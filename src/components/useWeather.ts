import { useEffect, useState } from 'react';
import { OUTDOOR_TEMP, WEATHER } from '../config/entities';
import { useHass } from '../ha/api';
import { loadRegistry, REGISTRY_REFRESH_MS } from '../ha/registry';
import { store, useEntity } from '../ha/store';
import { num } from '../ha/format';
import { conditionText, weatherExtras, type WeatherExtras } from '../lib/weather';

const CACHE_KEY = 'dashWeatherExtras';

function cachedExtras(): WeatherExtras {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { weather: string; extras: WeatherExtras } | null;
    return c?.weather === WEATHER ? c.extras : {};
  } catch {
    return {};
  }
}

// Sensors on the weather entity's device (rain chance, storm chance, ...),
// discovered from the registry so a new weather integration needs no config.
// Cached per device so reloads show them at once.
export function useWeatherExtras(): WeatherExtras {
  const hass = useHass();
  const [extras, setExtras] = useState(cachedExtras);

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadRegistry(hass)
        .then((r) => {
          if (!alive) return;
          const all = store.getAll();
          const next = weatherExtras(
            WEATHER,
            r.entities.map((e) => ({ ...e, deviceClass: all[e.entityId]?.attributes.device_class as string | undefined })),
          );
          setExtras((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ weather: WEATHER, extras: next }));
          } catch {
            /* storage blocked: rediscover next time */
          }
        })
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hass]);

  return extras;
}

const attrNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Current conditions: the weather entity's attributes plus its extra sensors.
export function useWeatherNow() {
  const weather = useEntity(WEATHER);
  const outdoor = useEntity(OUTDOOR_TEMP);
  const extras = useWeatherExtras();
  const text = useEntity(extras.weather_condition);
  const rainChance = useEntity(extras.precipitation_probability);
  const rainRate = useEntity(extras.precipitation_intensity);
  const storm = useEntity(extras.thunderstorm_probability);
  const heatIndex = useEntity(extras.heat_index);
  const windChill = useEntity(extras.wind_chill);
  const a = weather?.attributes ?? {};

  return {
    weather,
    condition: weather?.state,
    label: conditionText(weather?.state, text?.state),
    temp: num(outdoor) ?? attrNum(a.temperature),
    feelsLike: attrNum(a.apparent_temperature),
    humidity: attrNum(a.humidity),
    dewPoint: attrNum(a.dew_point),
    windSpeed: attrNum(a.wind_speed),
    windGust: attrNum(a.wind_gust_speed),
    windBearing: attrNum(a.wind_bearing),
    windUnit: (a.wind_speed_unit as string | undefined) ?? 'km/h',
    uv: attrNum(a.uv_index),
    visibility: attrNum(a.visibility),
    visibilityUnit: (a.visibility_unit as string | undefined) ?? 'km',
    pressure: attrNum(a.pressure),
    pressureUnit: (a.pressure_unit as string | undefined) ?? 'hPa',
    cloud: attrNum(a.cloud_coverage),
    rainChance: num(rainChance),
    rainRate: num(rainRate),
    rainRateUnit: (rainRate?.attributes.unit_of_measurement as string | undefined) ?? 'mm/h',
    storm: num(storm),
    heatIndex: num(heatIndex),
    windChill: num(windChill),
  };
}

export type WeatherNow = ReturnType<typeof useWeatherNow>;
