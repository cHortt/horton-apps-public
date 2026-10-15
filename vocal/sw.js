// Cache names are prefixed so this worker can drop its own old caches
// without touching another applet. Every applet on this Pages site shares
// one origin (chortt.github.io).
const CACHE_PREFIX = "vocal-";
const CACHE = `${CACHE_PREFIX}pitch-v3`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./sw.js",
  "./js/app.mjs",
  "./js/audio.mjs",
  "./js/musicxml.mjs",
  "./js/render.mjs",
  "./js/theory.mjs",
  "./fixtures/satb-sample.musicxml",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Scope is the vocal folder. Do not satisfy another applet's request even
  // if a registration is ever broader than that folder.
  if (!url.href.startsWith(self.registration.scope)) return;
  if (!ASSETS.some((asset) => url.pathname.endsWith(asset.replace("./", "/")))) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
