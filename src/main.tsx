import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import localConfig from 'virtual:dashboard-config';
import { HaProvider, haApi } from './ha/HaProvider';
import { cacheConfig, fetchConfig, loadCachedConfig } from './config/load';
import './styles/fonts.css';
import './styles/app.css';

// Mock provider is only pulled in for `npm run mock`; the dynamic import is
// dead-code-eliminated from production builds.
const MockProvider = import.meta.env.VITE_MOCK ? lazy(() => import('../mock/MockProvider')) : null;

const Provider = MockProvider ?? HaProvider;

const root = createRoot(document.getElementById('root')!);
const splash = (content: ReactNode) => root.render(<div className="splash">{content}</div>);

async function boot() {
  // Dev and mock builds embed the config. Production fetches it from HA after
  // login, and uses this device's cached copy when it has one.
  let cfg = localConfig ?? loadCachedConfig();
  if (!cfg) {
    splash(
      <>
        <span className="sync-spinner big" />
        Connecting…
      </>,
    );
    try {
      cfg = await fetchConfig((urlPath) => haApi.fetchLovelaceConfig(urlPath));
      cacheConfig(cfg);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? String(err);
      splash(`Couldn't load the dashboard config from Home Assistant (${msg}). Deploy it with python scripts/deploy.py --config-only.`);
      return;
    }
  }
  window.__DASHBOARD_CONFIG__ = cfg.config;
  window.__DASHBOARD_CONFIG_HASH__ = cfg.hash;

  // The app reads the config at module load, so it is imported only now. The
  // bundle is a single file, so this resolves in a microtask.
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
