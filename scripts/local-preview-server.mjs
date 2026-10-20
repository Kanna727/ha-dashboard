#!/usr/bin/env node
// Static server for the local preview (started by scripts/local-preview.mjs).
//   node scripts/local-preview-server.mjs <site dir> [port] [assets dir]
// Files missing from the site are looked up in the assets dir (the owner's car
// photo and 3D model, which are never part of a build).
// Localhost only, never cached, so a rebuild shows on the next request.
// GET /__local-preview reports which site it serves and its pid.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const site = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 4180);
const assets = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__local-preview') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ site, assets, pid: process.pid }));
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(site, path.normalize(rel));
    if (!file.startsWith(site + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const extra = assets ? path.join(assets, path.normalize(rel)) : undefined;
    const send = (err, data) => {
      if (err) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    };
    fs.readFile(file, (err, data) => {
      if (!err || !extra || !extra.startsWith(assets + path.sep)) return send(err, data);
      fs.readFile(extra, (err2, data2) => (err2 ? send(err2) : send(null, data2, extra)));
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`Local preview: http://localhost:${port}/ (${site})`));
