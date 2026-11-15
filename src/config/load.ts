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
// Names the owner gave the router's clients (the network popup), saved from the dashboard itself.
export const NAMES_DASHBOARD = 'dashboard-names';
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
  if (!c?.hash || !c.config) throw new NoConfigError();
  // Without the storage layer's sync block (storage/envelope.ts).
  return { hash: c.hash, config: c.config };
}

// HA has no config yet (a first install): the setup editor starts one.
export class NoConfigError extends Error {
  constructor() {
    super(`the "${CONFIG_DASHBOARD}" dashboard holds no config`);
    this.name = 'NoConfigError';
  }
}

// ---- the setup editor's live preview -------------------------------------
// The editor runs the dashboard in an iframe on the draft config: it writes the
// draft here and loads the page with ?previewDraft. That copy runs the real
// panels on live data but never reloads itself onto the saved config, mirrors no
// alerts and talks to no extension (App.tsx, useSelfUpdate.ts).
export const DRAFT_KEY = 'dashConfigDraft';
// Mock builds (the deployed preview included) keep a saved config here, since
// their own is embedded: it lets the whole edit → save → reload loop be tried.
export const MOCK_CONFIG_KEY = 'mockConfigOverride';

export function isDraftPreview(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('previewDraft');
  } catch {
    return false;
  }
}

export function loadDraftConfig(): StoredConfig | null {
  if (!isDraftPreview()) return null;
  try {
    const c = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { config?: DashboardConfig } | null;
    return c?.config ? { hash: 'draft', config: c.config } : null;
  } catch {
    return null;
  }
}

export function loadMockOverride(): StoredConfig | null {
  if (!import.meta.env.VITE_MOCK) return null;
  try {
    const c = JSON.parse(localStorage.getItem(MOCK_CONFIG_KEY) ?? 'null') as StoredConfig | null;
    return c?.hash && c.config ? c : null;
  } catch {
    return null;
  }
}
