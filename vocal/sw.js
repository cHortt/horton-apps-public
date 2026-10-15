const CACHE = "vocal-pitch-v1";
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
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!ASSETS.some((asset) => url.pathname.endsWith(asset.replace("./", "/")))) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
