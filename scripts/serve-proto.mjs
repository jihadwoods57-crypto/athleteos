#!/usr/bin/env node
// Dependency-free static server for the shipped WebView prototype. The proto uses native ES modules,
// which the browser refuses to load over file:// — so QC/screenshot runs need a real HTTP origin.
// No npm deps (http + fs only) so it works on any checkout without install.
//
// Usage: node scripts/serve-proto.mjs [port]   (default 8799)
// Serves proto/redesign-2026-07/ at http://localhost:<port>/index.html
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'proto', 'redesign-2026-07');
const PORT = Number(process.argv[2]) || 8799;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    // Contain to ROOT — no path traversal.
    const abs = normalize(join(ROOT, path));
    if (!abs.startsWith(normalize(ROOT))) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(abs).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(abs);
    res.writeHead(200, { 'Content-Type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => {
  process.stdout.write(`proto served → http://localhost:${PORT}/index.html  (Ctrl-C to stop)\n`);
});
