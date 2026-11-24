import assert from "node:assert/strict";
import test from "node:test";
import {
  channelLabel,
  channelsForScore,
  createMix,
  dbToSlider,
  defaultLevels,
  formatLevel,
  playbackMix,
  sliderToDb,
} from "../js/mix.mjs";
import { dbToGain } from "../js/theory.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

test("defaults match the all-parts levels", () => {
  const mix = createMix(memoryStorage());
  assert.deepEqual(mix.levels(), defaultLevels());
  assert.deepEqual(mix.levels(), { S: 0, A: 0, T: 0, B: 0, P: -6 });
  const play = mix.playback();
  for (const channel of ["S", "A", "T", "B"]) {
    assert.equal(play.gains[channel], 1);
    assert.equal(play.mutes[channel], false);
  }
  assert.ok(Math.abs(play.gains.P - dbToGain(-6)) < 1e-12);
  assert.equal(play.mutes.P, false);
  assert.equal(formatLevel(0), "0 dB");
  assert.equal(formatLevel(-6), "-6 dB");
});

test("Off is fully left and mutes that channel", () => {
  assert.equal(sliderToDb(0), null);
  assert.equal(dbToSlider(null), 0);
  assert.equal(sliderToDb(1), -24);
  assert.equal(sliderToDb(dbToSlider(0)), 0);
  assert.equal(sliderToDb(dbToSlider(6)), 6);
  assert.equal(sliderToDb(dbToSlider(-24)), -24);
  assert.equal(formatLevel(null), "Off");
  const mix = createMix(memoryStorage());
  const play = mix.set("T", sliderToDb(0));
  assert.equal(mix.levels().T, null);
  assert.equal(play.mutes.T, true);
  assert.equal(play.gains.T, 0);
  assert.equal(play.mutes.S, false);
  assert.equal(play.gains.S, 1);
  assert.equal(play.mutes.A, false);
  assert.equal(play.gains.B, 1);
  const floor = playbackMix({ ...defaultLevels(), S: -24 });
  assert.equal(floor.mutes.S, false);
  assert.ok(Math.abs(floor.gains.S - dbToGain(-24)) < 1e-12);
  mix.set("A", 12);
  mix.set("P", -40);
  assert.equal(mix.levels().A, 6);
  assert.equal(mix.levels().P, -24);
  assert.equal(formatLevel(6), "+6 dB");
});

test("levels round-trip through storage", () => {
  const storage = memoryStorage();
  const mix = createMix(storage);
  mix.set("S", 4);
  mix.set("A", -24);
  mix.set("P", null);
  const again = createMix(storage);
  assert.deepEqual(again.levels(), { S: 4, A: -24, T: 0, B: 0, P: null });
  const play = again.playback();
  assert.equal(play.mutes.P, true);
  assert.equal(play.gains.P, 0);
  assert.ok(Math.abs(play.gains.A - dbToGain(-24)) < 1e-12);
  assert.equal(play.gains.T, 1);
  again.reset();
  assert.deepEqual(createMix(storage).levels(), defaultLevels());
});

test("a tab switch and a new file leave the levels", () => {
  const storage = memoryStorage();
  const mix = createMix(storage);
  mix.set("B", 3);
  mix.set("S", null);
  const before = mix.levels();
  mix.selectPart("A");
  mix.openFile();
  assert.deepEqual(mix.levels(), before);
  assert.deepEqual(createMix(storage).levels(), before);
  const play = mix.playback();
  assert.equal(play.mutes.S, true);
  assert.equal(play.gains.B, dbToGain(3));
});

test("slider labels come from the part-name table", () => {
  const names = { S: "Alto", A: "Soprano", T: "Tenor", B: "Bass", P: "Piano" };
  assert.equal(channelLabel(names, "S"), "Alto");
  assert.equal(channelLabel(names, "A"), "Soprano");
  assert.equal(channelLabel(names, "T"), "Tenor");
  assert.equal(channelLabel(names, "P"), "Piano");
});

test("bass is a slider only when the file has bass", () => {
  assert.deepEqual(channelsForScore(null), ["S", "A", "T", "P"]);
  const single = { parts: [{ role: "SA", measures: [{ notes: [{ parts: ["S"] }, { parts: ["A"] }, { parts: ["T"] }] }] }] };
  assert.deepEqual(channelsForScore(single), ["S", "A", "T", "P"]);
  const withBass = { parts: [{ role: "SA", measures: [{ notes: [{ parts: ["S"] }, { parts: ["B"] }] }] }] };
  assert.deepEqual(channelsForScore(withBass), ["S", "A", "T", "B", "P"]);
  const satb = { parts: [{ role: "SA", measures: [] }, { role: "TB", measures: [] }] };
  assert.deepEqual(channelsForScore(satb), ["S", "A", "T", "B", "P"]);
  const lowerOnly = { parts: [{ role: "TB", measures: [{ notes: [{ parts: ["T"] }] }] }] };
  assert.deepEqual(channelsForScore(lowerOnly), ["T", "B", "P"]);
});
