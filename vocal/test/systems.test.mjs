import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseScore } from "../js/musicxml.mjs";
import { hitTest, locateQl, renderScore } from "../js/render.mjs";

const xml = readFileSync(new URL("../fixtures/song-title.musicxml", import.meta.url), "utf8");
const score = parseScore(xml);
const base = { activePart: "A", selectedId: null, showChanges: false, playMeasure: 0, scope: "chord" };

test("the placeholder score is the synthetic Song title sheet", () => {
  assert.equal(score.title, "Song title");
  assert.equal(score.parts[0].staffLabel, "Vocal");
  assert.equal(score.parts[0].measures.length, 16);
  assert.equal(score.parts[0].measures[0].notes.find((note) => note.lyric)?.lyric.text, "la");
});

test("measures wrap onto the same systems as the B4 mock", () => {
  const portrait = renderScore(score, { ...base, wrapWidth: 374 });
  const landscape = renderScore(score, { ...base, wrapWidth: 656 });
  const ipad = renderScore(score, { ...base, wrapWidth: 1164 });
  assert.deepEqual(portrait.systems.map((system) => [system.first, system.last]), [
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7],
    [8, 8], [9, 9], [10, 10], [11, 11], [12, 12], [13, 13], [14, 14], [15, 15],
  ]);
  assert.deepEqual(landscape.systems.map((system) => [system.first, system.last]), [
    [0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15],
  ]);
  assert.deepEqual(ipad.systems.map((system) => [system.first, system.last]), [
    [0, 3], [4, 8], [9, 12], [13, 15],
  ]);
  assert.equal(portrait.systems[0].gw, 107);
  assert.equal(portrait.systems[1].gw, 80);
  assert.ok(portrait.systems.every((system) => system.svg.includes("𝄞")));
  assert.match(portrait.gutter, />Vocal</);
});

test("a tap on a later system hits that system's note, and the playhead follows the same system", () => {
  const view = renderScore(score, { ...base, wrapWidth: 374 });
  const note = view.notes.find((item) => item.pitchLabel === "A4" && item.measureNumber === "2" && item.parts.includes("A"));
  assert.equal(note.systemIndex, 1);
  const hit = hitTest(view, note.systemIndex, note.hitX, note.hitY, "A");
  assert.equal(hit.type, "note");
  assert.equal(hit.note.id, note.id);
  assert.notEqual(hitTest(view, 0, note.hitX, note.hitY, "A")?.note?.id, note.id);
  assert.equal(hitTest(view, 0, 8, 70, "A"), null);
  const elsewhere = hitTest(view, note.systemIndex, note.hitX + 80, note.hitY + 40, "A");
  assert.equal(elsewhere.type, "empty");
  assert.equal(elsewhere.measure.index, 1);
  const located = locateQl(view, note.absQl + 0.05);
  assert.equal(located.systemIndex, 1);
  assert.ok(located.localX > 0 && located.localX < view.systems[1].end - view.systems[1].start);
  const wide = renderScore(score, { ...base, wrapWidth: 1164 });
  const later = wide.measures[9].notes.find((item) => item.pitchLabel);
  assert.equal(locateQl(wide, later.absQl + 0.05).systemIndex, later.systemIndex);
  assert.equal(later.systemIndex, 2);
});

test("without a wrap width the engraving stays one line", () => {
  const view = renderScore(score, base);
  assert.equal(view.systems, null);
  assert.match(view.music, /height="126"/);
  assert.match(view.gutter, />Vocal</);
});
