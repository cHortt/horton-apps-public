import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const swSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../js/app.mjs", import.meta.url), "utf8");

function loadWorker() {
  const sandbox = vm.createContext({ Promise, URL });
  vm.runInContext(
    `
    var deleted = [];
    var listeners = {};
    var fetch = async () => ({ ok: true, clone() { return this; } });
    var caches = {
      keys: async () => ["vocal-pitch-v1", "vocal-pitch-v2", "vocal-pitch-v3", "vocal-pitch-v4", "vocal-pitch-v5", "vocal-pitch-v6", "vocal-pitch-v7", "grocery-deals-v1", "unrelated"],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {}, match: async () => null, put: async () => {} }),
      match: async () => ({ ok: true }),
    };
    var self = {
      addEventListener(type, fn) { listeners[type] = fn; },
      skipWaiting() { return Promise.resolve(); },
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://chortt.github.io" },
      registration: { scope: "https://chortt.github.io/horton-apps-public/vocal/" },
    };
  `,
    sandbox,
  );
  vm.runInContext(swSource, sandbox);
  return {
    deleted: () => vm.runInContext("deleted.slice()", sandbox),
    listeners: vm.runInContext("listeners", sandbox),
  };
}

test("activate deletes only vocal-prefixed caches", async () => {
  const worker = loadWorker();
  let pending;
  worker.listeners.activate({
    waitUntil(p) {
      pending = p;
    },
  });
  await pending;
  assert.deepEqual(Array.from(worker.deleted()), ["vocal-pitch-v1", "vocal-pitch-v2", "vocal-pitch-v3", "vocal-pitch-v4", "vocal-pitch-v5", "vocal-pitch-v6"]);
  assert.match(swSource, /\$\{CACHE_PREFIX\}pitch-v7/);
});

test("fetch ignores requests outside the vocal scope", async () => {
  const worker = loadWorker();
  const seen = [];
  const pending = [];
  const fire = (url) => {
    worker.listeners.fetch({
      request: { method: "GET", url },
      respondWith(result) {
        seen.push(url);
        if (result?.then) pending.push(result);
      },
    });
  };
  fire("https://chortt.github.io/horton-apps-public/grocery/index.html");
  fire("https://chortt.github.io/horton-apps-public/vocal/style.css");
  fire("https://chortt.github.io/horton-apps-public/vocal/samples/flute/60.wav");
  fire("https://example.com/horton-apps-public/vocal/samples/flute/60.wav");
  assert.deepEqual(seen, [
    "https://chortt.github.io/horton-apps-public/vocal/style.css",
    "https://chortt.github.io/horton-apps-public/vocal/samples/flute/60.wav",
  ]);
  await Promise.all(pending);
});

test("the vocal worker is registered for this folder only", () => {
  assert.match(appSource, /register\(\s*"sw\.js"\s*,\s*\{\s*scope:\s*"\.\/"\s*\}\s*\)/);
});
