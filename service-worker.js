const CACHE_PREFIX = "mirror-library-";
const CACHE = "mirror-library-v57";
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

  const cachePromise = caches.open(CACHE);
  const updatePromise = cachePromise.then(async cache => {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  });

  // Keep the background refresh alive even when a cached response is returned.
  event.waitUntil(updatePromise.then(() => undefined).catch(() => undefined));
  event.respondWith(cachePromise.then(async cache => {
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      return await updatePromise;
    } catch {
      return Response.error();
    }
  }));
});
