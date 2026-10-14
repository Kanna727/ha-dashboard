import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const PRIVATE_CONFIG = resolve(__dirname, 'config/dashboard.config.ts');
const EXAMPLE_CONFIG = resolve(__dirname, 'config/dashboard.config.example.ts');

// The per-home config is compiled to its own config.js (next to index.html) so
// the release bundle stays generic. Mock builds always use the example config,
// which matches mock/fixtures.ts. DASHBOARD_CONFIG overrides the path.
function configSource(): string {
  if (process.env.VITE_MOCK) return EXAMPLE_CONFIG;
  if (process.env.DASHBOARD_CONFIG) return resolve(process.env.DASHBOARD_CONFIG);
  return existsSync(PRIVATE_CONFIG) ? PRIVATE_CONFIG : EXAMPLE_CONFIG;
}

async function compileConfig(entry: string): Promise<string> {
  const out = await esbuild({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__dashCfg',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
  });
  const code = out.outputFiles[0].text;
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
  return `${code}window.__DASHBOARD_CONFIG__=__dashCfg.default;window.__DASHBOARD_CONFIG_HASH__=${JSON.stringify(hash)};\n`;
}

function dashboardConfig(): Plugin {
  const entry = configSource();
  return {
    name: 'dashboard-config',
    configResolved(cfg) {
      if (entry === EXAMPLE_CONFIG && !process.env.VITE_MOCK) {
        cfg.logger.warn('config/dashboard.config.ts not found; config.js is built from the example config.');
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/config.js')) return next();
        try {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(await compileConfig(entry));
        } catch (err) {
          next(err);
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'config.js', source: await compileConfig(entry) });
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
