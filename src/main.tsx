import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import localConfig from 'virtual:dashboard-config';
import { HaProvider, haApi } from './ha/HaProvider';
import { cacheConfig, fetchConfig, loadCachedConfig, loadDraftConfig, loadMockOverride, NoConfigError } from './config/load';
import './styles/fonts.css';
import './styles/app.css';
import './styles/setup.css';
import './styles/insights.css';
import './styles/invest.css';

// Mock provider is only pulled in for `npm run mock`; the dynamic import is
// dead-code-eliminated from production builds.
const MockProvider = import.meta.env.VITE_MOCK ? lazy(() => import('../mock/MockProvider')) : null;

const Provider = MockProvider ?? HaProvider;

const root = createRoot(document.getElementById('root')!);
const splash = (content: ReactNode) => root.render(<div className="splash">{content}</div>);

async function boot() {
  // Dev and mock builds embed the config. Production fetches it from HA after
  // login, and uses this device's cached copy when it has one. The setup editor's
  // live preview runs the draft instead (a mock build runs the config it saved).
  const cfg = loadDraftConfig() ?? loadMockOverride() ?? localConfig ?? loadCachedConfig();
  if (!cfg) {
    // First visit on this device. The bundle is a single file, so the app's
    // modules have already run (with an empty config) by the time the fetch
    // returns; cache the config and reload so they start with it.
    splash(
      <>
        <span className="sync-spinner big" />
        Connecting…
      </>,
    );
    try {
      if (cacheConfig(await fetchConfig((urlPath) => haApi.fetchLovelaceConfig(urlPath)))) window.location.reload();
      else splash('This browser blocks local storage, which the dashboard needs. Allow site data for this page.');
    } catch (err) {
      if (err instanceof NoConfigError) {
        // A fresh install: nothing to show yet, so start the setup editor.
        const { SetupOnly } = await import('./setup/SetupOnly');
        root.render(
          <StrictMode>
            <Provider>
              <SetupOnly />
            </Provider>
          </StrictMode>,
        );
        return;
      }
      const msg = (err as { message?: string })?.message ?? String(err);
      splash(`Couldn't load the dashboard config from Home Assistant (${msg}). Deploy it with python scripts/deploy.py --config-only.`);
    }
    return;
  }
  // Set synchronously, before any await: the app's modules read it as soon as
  // this function yields.
  window.__DASHBOARD_CONFIG__ = cfg.config;
  window.__DASHBOARD_CONFIG_HASH__ = cfg.hash;

  const { App } = await import('./App');
  root.render(
    <StrictMode>
      <Suspense fallback={<div className="splash">Loading…</div>}>
        <Provider>
          <App />
        </Provider>
      </Suspense>
    </StrictMode>,
  );
}

boot();

// The deployed preview (a mock build) reloads itself when a newer one lands.
if (import.meta.env.VITE_MOCK) void import('./update/previewUpdate').then((m) => m.watchPreviewUpdates());
