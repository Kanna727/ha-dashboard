// The per-home config is stored in Home Assistant as a hidden storage-mode
// Lovelace dashboard, so reading it needs a logged-in user (unlike /local/,
// which HA serves to anyone). Each device keeps a copy in localStorage so
// reloads can paint before the connection is up.
import type { DashboardConfig } from './types';

export interface StoredConfig {
  hash: string;
  config: DashboardConfig;
}

export const CONFIG_DASHBOARD = 'dashboard-config';
// The shared card layout (layout/Canvas.tsx), saved from the dashboard itself.
export const LAYOUT_DASHBOARD = 'dashboard-layout';
const CACHE_KEY = 'dashConfig';

export function loadCachedConfig(): StoredConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as StoredConfig | null;
    return c?.hash && c.config ? c : null;
  } catch {
    return null;
  }
}

// False when storage is full or blocked; the next load then fetches it again.
export function cacheConfig(c: StoredConfig): boolean {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    return loadCachedConfig()?.hash === c.hash;
  } catch {
    return false;
  }
}

export async function fetchConfig(fetchLovelace: (urlPath: string) => Promise<unknown>): Promise<StoredConfig> {
  const c = (await fetchLovelace(CONFIG_DASHBOARD)) as Partial<StoredConfig> | null;
  if (!c?.hash || !c.config) throw new Error(`the "${CONFIG_DASHBOARD}" dashboard holds no config`);
  return c as StoredConfig;
}
