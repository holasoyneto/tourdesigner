/* Tour Designer Service Worker — public app shell only (authorized tour data lives in IndexedDB) */
const VERSION = "td-shell-490338d753ae";
const ASSETS = ["/static/v3/index.html","/static/v3/manifest.webmanifest","/static/v3/icon.svg","/static/v3/assets/CalendarPage-CdMq33vU.js","/static/v3/assets/CommunityShareModal-C6g8NZ3a.js","/static/v3/assets/ContactsPage-DI4tm1dp.js","/static/v3/assets/DemoPage-thzfwHAx.js","/static/v3/assets/FilesPage-Dv5uf5lI.js","/static/v3/assets/FirstDayChecklist-uHahesp1.js","/static/v3/assets/HelpPage-CpFEWY5g.js","/static/v3/assets/LandingPage-CNZr4PTI.js","/static/v3/assets/LegalPage-DKTlk8Vv.js","/static/v3/assets/PasteWindow-dJZiW65S.js","/static/v3/assets/PrintPage-DhpMGF3H.js","/static/v3/assets/SettingsPage-DyVzN8dl.js","/static/v3/assets/SharePage-BZHBEnLO.js","/static/v3/assets/SyncPage-B-INxKkr.js","/static/v3/assets/TrashPage-31i9Mxf6.js","/static/v3/assets/index-DdY3rwJ3.js","/static/v3/assets/index-JJ5BQlbH.css","/static/v3/assets/vendor-Bb8JjhAW.js","/static/v3/assets/vendor-dexie-4JlzNDPg.js","/static/v3/assets/vendor-icons-Bbrnyb1P.js","/static/v3/assets/vendor-react-DEoZpdCg.js"];

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
