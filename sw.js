/* SAT Math PWA service worker.
   Strategy: network-first for same-origin GETs (so code fixes and the daily
   coach's fresh questions always load when online), with a cache fallback so
   the app still opens offline. Bump VERSION to invalidate old caches. */
const VERSION = "satmath-v5";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./data.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./apple-touch-icon.png", "./qr.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Desmos / CDN go straight to network
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(VERSION);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") return caches.match("./index.html");
      throw err;
    }
  })());
});
