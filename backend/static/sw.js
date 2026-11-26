/* Tour Designer Service Worker — public app shell only (authorized tour data lives in IndexedDB) */
const VERSION = "td-shell-e9bb7f72ee46";
const ASSETS = ["/static/v3/index.html","/static/v3/manifest.webmanifest","/static/v3/icon.svg","/static/v3/assets/CalendarPage-DxSCh2sV.js","/static/v3/assets/CommunityShareModal-DcVooEeV.js","/static/v3/assets/ContactsPage-Dl1J0MK7.js","/static/v3/assets/DemoPage-Y0lVQll4.js","/static/v3/assets/FilesPage-DfkUlnhy.js","/static/v3/assets/FirstDayChecklist-uHahesp1.js","/static/v3/assets/HelpPage-DWicZsM1.js","/static/v3/assets/LandingPage-B_n57slx.js","/static/v3/assets/LegalPage-z15Huee4.js","/static/v3/assets/PasteWindow-qTXC2SpG.js","/static/v3/assets/PrintPage-CTuWeReW.js","/static/v3/assets/SettingsPage-BCUPd0NK.js","/static/v3/assets/SharePage-BCsq36gr.js","/static/v3/assets/SyncPage-BwAeAUjM.js","/static/v3/assets/TrashPage-B6-kwSTi.js","/static/v3/assets/index-BS-Znv38.js","/static/v3/assets/index-LvGoEDYF.css","/static/v3/assets/vendor-Bb8JjhAW.js","/static/v3/assets/vendor-dexie-4JlzNDPg.js","/static/v3/assets/vendor-icons-Cp-z8fXC.js","/static/v3/assets/vendor-react-DEoZpdCg.js"];

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
