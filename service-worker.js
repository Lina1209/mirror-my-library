const CACHE_PREFIX = "mirror-library-";
const CACHE = "mirror-library-v60";
const CORE = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/reader-experience.js",
  "./js/translation.js",
  "./js/document-studio.js",
  "./js/db.js",
  "./js/parsers.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // Prefer the deployed version immediately; use the local cache only when offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === "basic") {
        try {
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn("Mirror cache update skipped:", error);
        }
      }
      return response;
    } catch {
      const cached = await cache.match(request);
      return cached || Response.error();
    }
  })());
});
