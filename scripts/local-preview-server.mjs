#!/usr/bin/env node
// Static server for the local preview (started by scripts/local-preview.mjs).
//   node scripts/local-preview-server.mjs <site dir> [port]
// Localhost only, never cached, so a rebuild shows on the next request.
// GET /__local-preview reports which site it serves and its pid.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const site = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 4180);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__local-preview') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ site, pid: process.pid }));
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(site, path.normalize(rel));
    if (!file.startsWith(site + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`Local preview: http://localhost:${port}/ (${site})`));
