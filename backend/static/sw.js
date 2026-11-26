/* Tour Designer Service Worker — public app shell only (authorized tour data lives in IndexedDB) */
const VERSION = "td-shell-faa0c252fded";
const ASSETS = ["/static/v3/index.html","/static/v3/manifest.webmanifest","/static/v3/icon.svg","/static/v3/assets/CalendarPage-J1DlwSRS.js","/static/v3/assets/CommunityShareModal-cq-jF153.js","/static/v3/assets/ContactsPage-D70VPGsc.js","/static/v3/assets/DemoPage-DvPls6p_.js","/static/v3/assets/FilesPage-3N0SmXOC.js","/static/v3/assets/FirstDayChecklist-uHahesp1.js","/static/v3/assets/HelpPage-CdeIRYr4.js","/static/v3/assets/LandingPage-BYAUPxSP.js","/static/v3/assets/LegalPage-BDXDny0H.js","/static/v3/assets/PasteWindow-Bf5q2CyI.js","/static/v3/assets/PrintPage-DsMA0hna.js","/static/v3/assets/SettingsPage-D82ZMedM.js","/static/v3/assets/SharePage-B54i0333.js","/static/v3/assets/SyncPage-CoylZqtZ.js","/static/v3/assets/TrashPage-CvYRU7me.js","/static/v3/assets/index-BsgSagcw.js","/static/v3/assets/index-JJ5BQlbH.css","/static/v3/assets/vendor-Bb8JjhAW.js","/static/v3/assets/vendor-dexie-4JlzNDPg.js","/static/v3/assets/vendor-icons-Bbrnyb1P.js","/static/v3/assets/vendor-react-DEoZpdCg.js"];

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
