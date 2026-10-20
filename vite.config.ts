import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const PRIVATE_CONFIG = resolve(__dirname, 'config/dashboard.config.ts');
const EXAMPLE_CONFIG = resolve(__dirname, 'config/dashboard.config.example.ts');

// The per-home config never ships in the release bundle. It is stored in HA
// (a hidden Lovelace dashboard, readable only after login) and fetched at
// runtime. `vite build` writes dist/dashboard-config.json for deploys to push;
// dev and mock builds embed it via `virtual:dashboard-config` instead. Mock
// builds always use the example config, which matches mock/fixtures.ts.
// DASHBOARD_CONFIG overrides the path.
function configSource(): string {
  if (process.env.VITE_MOCK) return EXAMPLE_CONFIG;
  if (process.env.DASHBOARD_CONFIG) return resolve(process.env.DASHBOARD_CONFIG);
  return existsSync(PRIVATE_CONFIG) ? PRIVATE_CONFIG : EXAMPLE_CONFIG;
}

// Evaluates the TS config to plain data: { hash, config }. The hash is over the
// JSON, so it is the same everywhere the config is stored.
async function loadConfig(entry: string): Promise<{ hash: string; config: unknown }> {
  const out = await esbuild({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__dashCfg',
    platform: 'browser',
    target: 'es2020',
  });
  const config: unknown = new Function(`${out.outputFiles[0].text}; return __dashCfg.default;`)();
  const hash = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 8);
  return { hash, config };
}

// The local preview (scripts/local-preview.mjs sets LOCAL_CAR) is a mock build,
// but shows the owner's own car photo and 3D model: the real config's
// CAR_DETAIL.image and .model replace the example's. The files themselves are
// served from the preview's assets folder. Never set in CI, so nothing private
// reaches a deployed preview.
async function withLocalCar(loaded: { hash: string; config: unknown }) {
  if (!process.env.VITE_MOCK || !process.env.LOCAL_CAR || !existsSync(PRIVATE_CONFIG)) return loaded;
  type Car = { CAR_DETAIL?: { image?: string; model?: unknown } };
  const real = (await loadConfig(PRIVATE_CONFIG)).config as Car;
  const cfg = loaded.config as Car;
  if (!real.CAR_DETAIL || !cfg.CAR_DETAIL) return loaded;
  const { image, model } = real.CAR_DETAIL;
  return { ...loaded, config: { ...cfg, CAR_DETAIL: { ...cfg.CAR_DETAIL, image, model } } };
}

const VIRTUAL_ID = 'virtual:dashboard-config';
const RESOLVED_ID = '\0' + VIRTUAL_ID; // Rollup convention for virtual modules

function dashboardConfig(): Plugin {
  const entry = configSource();
  let embed = false;
  return {
    name: 'dashboard-config',
    configResolved(cfg) {
      embed = cfg.command === 'serve' || !!process.env.VITE_MOCK;
      if (entry === EXAMPLE_CONFIG && !process.env.VITE_MOCK) {
        cfg.logger.warn('config/dashboard.config.ts not found; using the example config.');
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      if (!embed) return 'export default null;';
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(await withLocalCar(await loadConfig(entry)))};`;
    },
    async generateBundle() {
      if (process.env.VITE_MOCK) return;
      this.emitFile({ type: 'asset', fileName: 'dashboard-config.json', source: JSON.stringify(await loadConfig(entry)) });
    },
  };
}

// BUILD_HASH is the release version (set by CI or scripts/deploy.py); kiosks
// compare it against input_text.dashboard_build and reload when they differ.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), dashboardConfig()],
  define: {
    __BUILD_HASH__: JSON.stringify(process.env.BUILD_HASH ?? 'dev'),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { host: true, port: 5173 },
});
