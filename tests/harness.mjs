// Shared helpers for headless tests: a static file server for the repo and a Playwright loader.
// Playwright is pre-installed globally, so it is loaded with require() (ES imports can't see it).
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUT = join(ROOT, 'tests', 'out');
export const playwright = createRequire(import.meta.url)('playwright');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml',
};

export async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, close: () => new Promise(r => server.close(r)) };
}

export async function outDir() { await mkdir(OUT, { recursive: true }); return OUT; }

// Tiny assertion collector so one run reports every failure.
export function checker() {
  const failures = [];
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };
  const done = () => {
    console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
    process.exitCode = failures.length ? 1 : 0;
  };
  return { check, done };
}

// Watches a page for console errors, uncaught exceptions, failed requests and off-site requests.
export function watchPage(page, baseUrl) {
  const errors = [], external = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  page.on('request', r => { if (!r.url().startsWith(baseUrl) && !r.url().startsWith('data:')) external.push(r.url()); });
  return { errors, external };
}
