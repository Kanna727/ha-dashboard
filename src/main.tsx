import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HaProvider } from './ha/HaProvider';
import './styles/fonts.css';
import './styles/app.css';

// Mock provider is only pulled in for `npm run mock`; the dynamic import is
// dead-code-eliminated from production builds.
const MockProvider = import.meta.env.VITE_MOCK ? lazy(() => import('../mock/MockProvider')) : null;

const Provider = MockProvider ?? HaProvider;

const root = createRoot(document.getElementById('root')!);

if (!window.__DASHBOARD_CONFIG__) {
  root.render(
    <div className="splash">
      config.js is missing. Deploy it next to index.html (python scripts/deploy.py --config-only).
    </div>,
  );
} else {
  // The app reads config.js at module load, so it is imported only once the
  // config is known to be there. The bundle is a single file, so this resolves
  // in a microtask and nothing flashes.
  import('./App').then(({ App }) =>
    root.render(
      <StrictMode>
        <Suspense fallback={<div className="splash">Loading…</div>}>
          <Provider>
            <App />
          </Provider>
        </Suspense>
      </StrictMode>,
    ),
  );
}
