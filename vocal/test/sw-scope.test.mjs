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
    var caches = {
      keys: async () => ["vocal-pitch-v1", "vocal-pitch-v2", "grocery-deals-v1", "unrelated"],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {} }),
      match: async () => ({ ok: true }),
    };
    var self = {
      addEventListener(type, fn) { listeners[type] = fn; },
      skipWaiting() { return Promise.resolve(); },
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://chortt.github.io" },
      registration: { scope: "https://chortt.github.io/horton-life-ops-public/vocal/" },
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
  assert.deepEqual(Array.from(worker.deleted()), ["vocal-pitch-v1"]);
});

test("fetch ignores requests outside the vocal scope", () => {
  const worker = loadWorker();
  const seen = [];
  const fire = (url) => {
    worker.listeners.fetch({
      request: { method: "GET", url },
      respondWith() {
        seen.push(url);
      },
    });
  };
  fire("https://chortt.github.io/horton-life-ops-public/grocery/index.html");
  fire("https://chortt.github.io/horton-life-ops-public/vocal/style.css");
  assert.deepEqual(seen, ["https://chortt.github.io/horton-life-ops-public/vocal/style.css"]);
});

test("the vocal worker is registered for this folder only", () => {
  assert.match(appSource, /register\(\s*"sw\.js"\s*,\s*\{\s*scope:\s*"\.\/"\s*\}\s*\)/);
});
