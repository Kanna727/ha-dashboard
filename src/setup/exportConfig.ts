// The config as a file: a TypeScript module like config/dashboard.config.ts, so a
// config made in the editor can be kept in the repo's own format (and the next
// `deploy.py --config-only` doesn't push an older file over it).
import type { DashboardConfig } from '../config/types';

export function configAsTs(config: DashboardConfig): string {
  return [
    '// Exported from the dashboard\'s setup editor. Copy it to config/dashboard.config.ts',
    '// to keep it with the project (that file is gitignored).',
    "import type { DashboardConfig } from '../src/config/types';",
    '',
    `const config: DashboardConfig = ${JSON.stringify(config, null, 2)};`,
    '',
    'export default config;',
    '',
  ].join('\n');
}

export function configExport(config: DashboardConfig): void {
  const url = URL.createObjectURL(new Blob([configAsTs(config)], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dashboard.config.ts';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
