import type { HassApi, RegistrySnapshot } from './api';

export const REGISTRY_REFRESH_MS = 30 * 60_000;
let cache: { at: number; promise: Promise<RegistrySnapshot> } | null = null;

// The device/entity registry rarely changes, so share one fetch between all
// callers (status dialog, power plug discovery) and refresh it every 30 min.
export function loadRegistry(hass: HassApi, force = false): Promise<RegistrySnapshot> {
  if (!cache || force || Date.now() - cache.at > REGISTRY_REFRESH_MS) {
    cache = { at: Date.now(), promise: hass.fetchRegistry() };
    cache.promise.catch(() => {
      cache = null;
    });
  }
  return cache.promise;
}
