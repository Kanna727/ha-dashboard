import { BUILD_HASH } from './useSelfUpdate';

// The preview build (the mock dashboard deployed to /local/dashboard/preview/)
// has no HA connection, so it can't watch input_text.dashboard_build like the
// live dashboard. Instead it checks the version.json deployed next to it,
// bypassing the HTTP cache (HA serves /local/ with a 31-day max-age), and when
// a newer build is there it reloads with ?v=<version>, a URL the cache hasn't
// seen. Deploys write version.json last, after index.html.
// A local mock has no version.json, so this does nothing there.

const CHECK_MS = 5 * 60_000;
const GUARD_KEY = 'dashPreviewReloadFor';

async function check() {
  try {
    const res = await fetch(new URL('version.json', window.location.href), { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = (await res.json()) as { version?: string };
    if (!version || version === BUILD_HASH) {
      sessionStorage.removeItem(GUARD_KEY);
      return;
    }
    // One reload per version, so a stale file can't loop.
    if (sessionStorage.getItem(GUARD_KEY) === version) return;
    sessionStorage.setItem(GUARD_KEY, version);
    const url = new URL(window.location.href);
    url.searchParams.set('v', version);
    window.location.replace(url.toString());
  } catch {
    // offline, blocked storage or a bad file: try again later
  }
}

export function watchPreviewUpdates() {
  if (BUILD_HASH === 'dev') return;
  void check();
  window.setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
}
