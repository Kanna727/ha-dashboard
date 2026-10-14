import { useEffect } from 'react';
import { useEntity } from '../ha/store';
import { useHass, useHassStatus } from '../ha/api';
import { BUILD_HELPER, CONFIG_HASH } from '../config/entities';
import { cacheConfig, fetchConfig } from '../config/load';
import { saveSnapshotNow } from '../ha/snapshot';

declare const __BUILD_HASH__: string;
// The release version (e.g. 1.4.0), or 'dev' for local builds.
export const BUILD_HASH = __BUILD_HASH__;
// What a deploy writes to the helper: "<app version>/<config hash>".
export const DEPLOY_ID = `${BUILD_HASH}/${CONFIG_HASH}`;

const GUARD_KEY = 'dashReloadFor';

// Deploys (the release automation in HA, or deploy.py) write DEPLOY_ID into
// input_text.dashboard_build: a new app release changes the first half, a new
// config the second. Every open kiosk sees the state change over the
// WebSocket and reloads. When the config half changed, the new config is
// fetched into the device cache first, so the reload starts with it (this also
// catches a device that missed a config deploy while it was off).
// The ?v= param defeats any WebView cache; the sessionStorage guard stops a
// reload loop if the served file is still stale after one attempt.
export function useSelfUpdate() {
  const hass = useHass();
  const helper = useEntity(BUILD_HELPER);
  const { status } = useHassStatus();
  // Only trust live data: the cached snapshot may hold an older build hash.
  const target = status === 'live' ? helper?.state : undefined;

  useEffect(() => {
    if (BUILD_HASH === 'dev' || !target || target === 'unknown' || target === 'unavailable') return;
    if (target === DEPLOY_ID) {
      sessionStorage.removeItem(GUARD_KEY);
      return;
    }
    if (sessionStorage.getItem(GUARD_KEY) === target) return;
    sessionStorage.setItem(GUARD_KEY, target);
    const configChanged = target.split('/')[1] !== CONFIG_HASH;
    const refresh = configChanged
      ? fetchConfig((urlPath) => hass.fetchLovelaceConfig(urlPath))
          .then(cacheConfig)
          .catch(() => undefined)
      : Promise.resolve();
    const url = new URL(window.location.href);
    url.searchParams.set('v', target);
    refresh.then(() =>
      window.setTimeout(() => {
        saveSnapshotNow(); // so the reloaded page paints straight from cache
        window.location.replace(url.toString());
      }, 1500),
    );
  }, [target, hass]);
}
