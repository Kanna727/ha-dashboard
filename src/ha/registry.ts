import type { HassApi, RegistrySnapshot } from './api';

export const REGISTRY_REFRESH_MS = 30 * 60_000;
let cache: { at: number; promise: Promise<RegistrySnapshot> } | null = null;
let lastError: string | undefined;

// The device/entity registry rarely changes, so share one fetch between all
// callers (status dialog, power plug discovery) and refresh it every 30 min.
// A failed fetch is logged and remembered (registryError) so the UI can say
// why discovery found nothing, and the next call tries again.
export function loadRegistry(hass: HassApi, force = false): Promise<RegistrySnapshot> {
  if (!cache || force || Date.now() - cache.at > REGISTRY_REFRESH_MS) {
    const promise = hass.fetchRegistry();
    cache = { at: Date.now(), promise };
    promise.then(
      () => {
        lastError = undefined;
      },
      (e: unknown) => {
        lastError = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
        console.warn('Reading the device/entity registry failed:', e);
        if (cache?.promise === promise) cache = null;
      },
    );
  }
  return cache.promise;
}

export const registryError = () => lastError;
