// Saving the config from the editor. The config is the whole config of the hidden
// `dashboard-config` dashboard, `{ hash, config }`, which every device reads.
// A save applies only what the editor changed (draft.ts patches) to the config as
// it is stored right now, through the storage layer, so an admin saving from
// another screen at the same time doesn't lose their edits to this one's (and the
// other way round). Then the helper that tells open screens to reload is set to
// the new hash, and this device keeps the new config as its copy.
import { useCallback, useMemo } from 'react';
import { BUILD_HELPER } from '../config/entities';
import { cacheConfig, CONFIG_DASHBOARD, MOCK_CONFIG_KEY, type StoredConfig } from '../config/load';
import type { DashboardConfig } from '../config/types';
import { useHass } from '../ha/api';
import { store } from '../ha/store';
import { useSaveStoreDoc, useStoreDoc } from '../storage';
import { isPlainObject } from '../storage/envelope';
import { applyPatches, diff } from './draft';
import { configHash } from './hash';

// Only an admin changes the config, so a non-admin never saves it into the inbox list.
const OPTS = { title: 'Dashboard config', noInbox: true };

// The config as stored in HA right now (null until it has answered, or if there is none).
export function useStoredConfig(): StoredConfig | null {
  const doc = useStoreDoc(CONFIG_DASHBOARD, 'ConfigDoc', OPTS);
  return useMemo(() => {
    const d = doc as { hash?: unknown; config?: unknown } | null;
    return d && typeof d.hash === 'string' && isPlainObject(d.config) ? { hash: d.hash, config: d.config as unknown as DashboardConfig } : null;
  }, [doc]);
}

// The change to save: the stored config with just what the editor changed
// (`base` → `draft`) applied, and its new hash. Pure, so two admins saving
// different settings at once can be tested (setup.test.ts).
export function configChange(base: DashboardConfig, draft: DashboardConfig): (current: unknown) => StoredConfig {
  const patches = diff(base, draft);
  return (current) => {
    const stored = (current as { config?: unknown } | null)?.config;
    const config = applyPatches(isPlainObject(stored) ? (stored as unknown as DashboardConfig) : base, patches);
    return { hash: configHash(config), config };
  };
}

// `base` is the config the editor started from, `draft` what it was changed to.
// Resolves with what was stored.
export function useConfigSave(): (base: DashboardConfig, draft: DashboardConfig) => Promise<StoredConfig> {
  const hass = useHass();
  const update = useSaveStoreDoc(CONFIG_DASHBOARD, 'ConfigDoc', OPTS.title, OPTS);
  return useCallback(
    async (base, draft) => {
      const change = configChange(base, draft);
      let saved: StoredConfig | undefined;
      await update((current) => (saved = change(current)));
      if (!saved) throw new Error('Nothing was saved');

      // Open screens reload when the second half of the build helper changes.
      const helper = store.getAll()[BUILD_HELPER]?.state;
      if (helper && helper !== 'unknown' && helper !== 'unavailable') {
        const version = helper.split('/')[0];
        await hass.callService('input_text', 'set_value', { value: `${version}/${saved.hash}` }, { entity_id: BUILD_HELPER }).catch(() => undefined);
      }
      cacheConfig(saved);
      // A mock build embeds its config, so it keeps the saved one here (config/load.ts).
      if (import.meta.env.VITE_MOCK) {
        try {
          localStorage.setItem(MOCK_CONFIG_KEY, JSON.stringify(saved));
        } catch {
          // storage blocked: the mock keeps the embedded one
        }
      }
      return saved;
    },
    [hass, update],
  );
}
