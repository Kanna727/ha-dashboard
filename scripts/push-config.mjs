#!/usr/bin/env node
// Saves the built per-home config (dist/dashboard-config.json) into Home
// Assistant's hidden "dashboard-config" dashboard, creating it if needed, then
// writes "<app version>/<config hash>" to input_text.dashboard_build so open
// dashboards fetch the new config and reload.
//
//   HA_URL=http://homeassistant.local HA_TOKEN=... node scripts/push-config.mjs [--app-version 1.2.0] [file]
//
// HA_TOKEN is an admin long-lived access token. Without --app-version the
// helper keeps its current app version.
import { readFileSync } from 'node:fs';
import { callService, createConnection, createLongLivedTokenAuth } from 'home-assistant-js-websocket';

const DASHBOARD = 'dashboard-config';
const HELPER = 'input_text.dashboard_build';

const args = process.argv.slice(2);
const versionIdx = args.indexOf('--app-version');
const appVersion = versionIdx >= 0 ? args.splice(versionIdx, 2)[1] : undefined;
const file = args[0] ?? 'dist/dashboard-config.json';

const { HA_URL, HA_TOKEN } = process.env;
if (!HA_URL || !HA_TOKEN) {
  console.error('HA_URL and HA_TOKEN must be set');
  process.exit(2);
}

// Node 22+ has WebSocket built in; older versions use the ws package.
globalThis.WebSocket ??= (await import('ws')).default;

const stored = JSON.parse(readFileSync(file, 'utf-8'));
if (!stored.hash || !stored.config) throw new Error(`${file} is not a { hash, config } file`);

const conn = await createConnection({ auth: createLongLivedTokenAuth(HA_URL.replace(/\/$/, ''), HA_TOKEN) });
try {
  const dashboards = await conn.sendMessagePromise({ type: 'lovelace/dashboards/list' });
  if (!dashboards.some((d) => d.url_path === DASHBOARD)) {
    await conn.sendMessagePromise({
      type: 'lovelace/dashboards/create',
      url_path: DASHBOARD,
      title: 'Dashboard config',
      icon: 'mdi:code-json',
      show_in_sidebar: false,
      require_admin: false,
      mode: 'storage',
    });
    console.log(`created the hidden "${DASHBOARD}" dashboard`);
  }
  await conn.sendMessagePromise({ type: 'lovelace/config/save', url_path: DASHBOARD, config: stored });
  console.log(`saved config ${stored.hash}`);

  const states = await conn.sendMessagePromise({ type: 'get_states' });
  const current = states.find((s) => s.entity_id === HELPER)?.state ?? '';
  const value = `${appVersion ?? current.split('/')[0]}/${stored.hash}`;
  await callService(conn, 'input_text', 'set_value', { entity_id: HELPER, value });
  console.log(`${HELPER} = ${value}; dashboards will reload`);
} finally {
  conn.close();
}
