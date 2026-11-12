// Jazz Player service worker. Built into dist/sw.js by the pwa plugin in vite.config.ts,
// which fills in the two placeholders below.
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const PREFIX = "jazz-player-";
const CACHE = PREFIX + VERSION;
const scope = self.registration.scope;
const PAGE = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith("/__recording")) return;

  if (request.mode === "navigate") {
    // Network first so a new build shows up; the cached page when offline.
    event.respondWith(
      fetch(request).catch(() => caches.match(PAGE).then((r) => r || caches.match(new URL("index.html", scope).href))),
    );
    return;
  }

  // Assets: cache first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
