// Cache names are prefixed so this worker can drop its own old caches
// without touching another applet. Every applet on this Pages site shares
// one origin (chortt.github.io).
const CACHE_PREFIX = "vocal-";
const CACHE = `${CACHE_PREFIX}pitch-v11`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./sw.js",
  "./js/app.mjs",
  "./js/edit.mjs",
  "./js/audio.mjs",
  "./js/fflate.mjs",
  "./js/mix.mjs",
  "./js/mscz.mjs",
  "./js/musicxml.mjs",
  "./js/playback.mjs",
  "./js/render.mjs",
  "./js/samples.mjs",
  "./js/theory.mjs",
  "./js/voice.mjs",
  "./js/zip.mjs",
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

function isSample(url) {
  return /\/samples\/piano\/[0-9]+\.mp3$/.test(url.pathname);
}

async function sampleResponse(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Scope is the vocal folder. Do not satisfy another applet's request even
  // if a registration is ever broader than that folder.
  if (!url.href.startsWith(self.registration.scope)) return;
  // Instruments load on first use and stay in this cache. They are not in
  // the install list, so a visit that never presses Play does not download them.
  if (isSample(url)) {
    event.respondWith(sampleResponse(event.request));
    return;
  }
  if (!ASSETS.some((asset) => url.pathname.endsWith(asset.replace("./", "/")))) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
