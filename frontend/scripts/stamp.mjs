import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const staticRoot = resolve(process.cwd(), '../backend/static');
const v3Dir = join(staticRoot, 'v3');

// Remove deprecated desktop-updater stamp if present
rmSync(join(staticRoot, 'app-build.txt'), { force: true });

// Content-hashed service worker for offline shell caching
const hash = createHash('sha256');
const assets = ['/static/v3/index.html', '/static/v3/manifest.webmanifest', '/static/v3/icon.svg'];
function walk(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(full, rel);
    else {
      hash.update(rel);
      hash.update(readFileSync(full));
      if (rel.startsWith('/static/v3/assets/')) assets.push(rel);
    }
  }
}
walk(v3Dir, '/static/v3');
const version = `td-shell-${hash.digest('hex').slice(0, 12)}`;

const sw = `/* Tour Designer Service Worker — public app shell only (authorized tour data lives in IndexedDB) */
const VERSION = "${version}";
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp/")) return;
  if (url.pathname.startsWith("/static/v3/assets/") || url.pathname === "/static/v3/icon.svg" || url.pathname === "/static/v3/manifest.webmanifest") {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith((async () => {
      const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), 1200) : null;
      try {
        const net = await fetch(e.request, ac ? { signal: ac.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (net && net.ok) return net;
      } catch {}
      if (timer) clearTimeout(timer);
      const cached = await caches.match("/static/v3/index.html");
      return cached || fetch(e.request);
    })());
  }
});
`;

writeFileSync(join(staticRoot, 'sw.js'), sw, 'utf8');
console.log(`Stamped sw=${version}, precached=${assets.length} files`);
