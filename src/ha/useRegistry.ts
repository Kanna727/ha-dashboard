import { useEffect, useState } from 'react';
import { useHass, type RegistrySnapshot } from './api';
import { REGISTRY_REFRESH_MS, loadRegistry } from './registry';

// The shared device/entity registry (loadRegistry), refreshed every 30 min.
// Undefined until the first fetch answers.
export function useRegistry(): RegistrySnapshot | undefined {
  const hass = useHass();
  const [registry, setRegistry] = useState<RegistrySnapshot>();

  useEffect(() => {
    let alive = true;
    let retry: number | undefined;
    const load = () =>
      loadRegistry(hass)
        .then((r) => alive && setRegistry(r))
        // Failed (e.g. the connection dropped): try again in a minute, not in 30.
        .catch(() => {
          if (alive) retry = window.setTimeout(load, 60_000);
        });
    load();
    const id = window.setInterval(load, REGISTRY_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(retry);
    };
  }, [hass]);

  return registry;
}

// Discovery results kept per device in localStorage, so a reload draws the
// panel before the registry answers. Storage may be blocked: then it's
// rediscovered every load.
export function readCache<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}
