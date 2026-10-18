#!/usr/bin/env node
// Local preview: builds the test version of the dashboard (the mock with fake
// data and the sky test panel, the same build as the HA preview) and serves it
// at http://localhost:4180. An open tab reloads itself within seconds of each
// rebuild (src/update/previewUpdate.ts polls version.json).
//
//   node scripts/local-preview.mjs           rebuild now and make sure the server runs
//   node scripts/local-preview.mjs --hook    for the Claude Code Stop hook: rebuild only if
//                                            the sources changed since the last attempt
//   node scripts/local-preview.mjs --stop    stop the server
//   options: --port <n> (default 4180, or LOCAL_PREVIEW_PORT)
//
// On a checkout that can't hold node_modules (Google Drive), set BUILD_DIR (in
// the environment or in .env.local as BUILD_DIR=...): sources are mirrored there
// and built there, as scripts/deploy.py does.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const HOOK = args.includes('--hook');
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.LOCAL_PREVIEW_PORT || 4180);
// What the build reads. Everything else (docs, scripts, .git) doesn't change the page.
const INPUTS = ['src', 'mock', 'public', 'config', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', '.npmrc'];

function buildDir() {
  let dir = process.env.BUILD_DIR;
  if (!dir) {
    try {
      const m = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(/^\s*BUILD_DIR\s*=\s*(.+?)\s*$/m);
      if (m) dir = m[1].replace(/^["']|["']$/g, '');
    } catch {
      // no .env.local
    }
  }
  return path.resolve(dir || ROOT);
}

function* files(p) {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) for (const name of fs.readdirSync(p).sort()) yield* files(path.join(p, name));
  else yield p;
}

// A content hash of the build inputs (not mtimes: Google Drive touches files).
function fingerprint() {
  const h = createHash('sha1');
  for (const item of INPUTS)
    for (const f of files(path.join(ROOT, item))) {
      h.update(path.relative(ROOT, f));
      h.update(fs.readFileSync(f));
    }
  return h.digest('hex');
}

const hashFile = (p) => (fs.existsSync(p) ? createHash('sha1').update(fs.readFileSync(p)).digest('hex') : '');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function mirror(dest) {
  for (const item of INPUTS) {
    const from = path.join(ROOT, item);
    const to = path.join(dest, item);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }
}

function run(cmd, cmdArgs, opts) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/__local-preview', timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body) : { foreign: true });
        } catch {
          resolve({ foreign: true });
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function ensureServer(site) {
  const up = await ping();
  if (up && up.site === site) return 'running';
  if (up) return `port ${PORT} is busy with something else; pass --port <n> or free it`;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'local-preview-server.mjs'), site, String(PORT)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if ((await ping())?.site === site) return 'started';
  }
  return 'did not start';
}

async function stopServer() {
  const up = await ping();
  if (!up?.pid) return console.log(`No local preview server on port ${PORT}.`);
  process.kill(up.pid);
  console.log(`Stopped the local preview server (pid ${up.pid}).`);
}

// For the hook: stdout is a note, exit 2 wakes the agent with stderr.
function fail(msg) {
  console.error(`Local preview build failed:\n${msg}`);
  process.exit(HOOK ? 2 : 1);
}

async function main() {
  if (args.includes('--stop')) return stopServer();
  const work = buildDir();
  const out = path.join(work, '.local-preview');
  const site = path.join(out, 'site');
  const stampFile = path.join(out, 'stamp.json');
  const stamp = readJson(stampFile);
  const fp = fingerprint();

  // In the hook, rebuild only when the sources changed since the last attempt,
  // failed or not, so a broken build wakes the agent once, not on every turn.
  if (HOOK && stamp.fingerprint === fp && fs.existsSync(path.join(site, 'index.html'))) {
    await ensureServer(site);
    return;
  }

  fs.mkdirSync(out, { recursive: true });
  if (work !== ROOT) mirror(work);
  const lockHash = hashFile(path.join(work, 'package-lock.json'));
  if (!fs.existsSync(path.join(work, 'node_modules')) || stamp.lockHash !== lockHash) {
    // One command string: Windows needs a shell for npm.cmd, and Node warns about args with shell.
    const r = run('npm install --no-audit --no-fund', [], { cwd: work, shell: true });
    if (!r.ok) {
      fs.writeFileSync(stampFile, JSON.stringify({ ...stamp, fingerprint: fp }));
      fail(r.out.slice(-3000));
    }
  }

  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const version = `0.0.0-local.${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const next = path.join(out, 'next');
  const vite = path.join(work, 'node_modules', 'vite', 'bin', 'vite.js');
  const b = run(process.execPath, [vite, 'build', '--outDir', next, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: work,
    env: { ...process.env, VITE_MOCK: '1', VITE_PREVIEW: '1', BUILD_HASH: version },
  });
  fs.writeFileSync(stampFile, JSON.stringify({ fingerprint: fp, lockHash, version: b.ok ? version : stamp.version }));
  if (!b.ok) fail(b.out.slice(-3000));
  // version.json last: an open tab reloads when it changes.
  fs.writeFileSync(path.join(next, 'version.json'), JSON.stringify({ version }) + '\n');
  const old = path.join(out, 'old');
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(site)) fs.renameSync(site, old);
  fs.renameSync(next, site);
  fs.rmSync(old, { recursive: true, force: true });

  const server = await ensureServer(site);
  console.log(`Local preview ${version}: http://localhost:${PORT}/index.html (server ${server})`);
}

main().catch((e) => fail(e?.stack ?? String(e)));
