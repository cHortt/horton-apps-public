import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chromaticMove, defaultMix, diatonicMove, spell, staffStep } from "../js/theory.mjs";
import {
  editedName,
  exportScore,
  findNote,
  isEdited,
  iterNotes,
  parseScore,
  playbackEvents,
  setPitch,
  updatePitchBlock,
} from "../js/musicxml.mjs";

const fixturePath = new URL("../fixtures/satb-sample.musicxml", import.meta.url);
const fixtureXml = readFileSync(fixturePath, "utf8");

function load(xml = fixtureXml) {
  return parseScore(xml);
}

function isUnison(note, measure) {
  if (note.isRest || !note.pitch || note.parts.length !== 1) return false;
  const other = { S: "A", A: "S", T: "B", B: "T" }[note.parts[0]];
  return measure.notes.some(
    (o) =>
      o.id !== note.id &&
      !o.isRest &&
      o.pitch &&
      o.parts.length === 1 &&
      o.parts[0] === other &&
      Math.abs(o.startQl - note.startQl) < 1e-4 &&
      o.pitch.step === note.pitch.step &&
      (o.pitch.alter || 0) === (note.pitch.alter || 0) &&
      o.pitch.octave === note.pitch.octave,
  );
}

function pickThree(score) {
  const rows = [];
  for (const part of score.parts) {
    if (part.role !== "SA" && part.role !== "TB") continue;
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        if (!note.pitch) continue;
        rows.push({ note, measure, fifths: measure.fifths });
      }
    }
  }
  const alto = rows.find((r) => r.note.parts.length === 1 && r.note.parts[0] === "A" && isUnison(r.note, r.measure));
  const soprano = rows.find((r) => r.note.parts.length === 1 && r.note.parts[0] === "S" && !isUnison(r.note, r.measure));
  const tenor = rows.find((r) => r.note.parts.length === 1 && r.note.parts[0] === "T" && !isUnison(r.note, r.measure));
  assert.ok(alto, "expected an alto unison note");
  assert.ok(soprano, "expected a soprano note");
  assert.ok(tenor, "expected a tenor note");
  return [
    { ...soprano, dir: 1 },
    { ...alto, dir: -1 },
    { ...tenor, dir: 1 },
  ];
}

function pitchSlice(xml, score, id) {
  const found = findNote(score, id);
  assert.ok(found?.note.pitchRange, id);
  return xml.slice(found.note.pitchRange.start, found.note.pitchRange.end);
}

function cutRanges(xml, ranges) {
  let out = "";
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    assert.ok(range.start >= cursor, "overlapping ranges");
    out += xml.slice(cursor, range.start);
    cursor = range.end;
  }
  return out + xml.slice(cursor);
}

function pitchReport(beforeXml, before, afterXml, after, ids) {
  return ids.map((id) => {
    const b = pitchSlice(beforeXml, before, id).replace(/\s+/g, " ").trim();
    const a = pitchSlice(afterXml, after, id).replace(/\s+/g, " ").trim();
    const note = findNote(after, id).note;
    return `${id} ${note.parts.join("+")} m${findNote(after, id).measure.number}: ${b}  =>  ${a}`;
  });
}

test("scale steps, chromatic spelling, and rehearsal mix", () => {
  assert.equal(spell(diatonicMove({ step: "E", alter: 0, octave: 4 }, 3, 1)), "F#4");
  assert.equal(spell(diatonicMove({ step: "A", alter: 0, octave: 4 }, 3, -1)), "G#4");
  assert.equal(spell(diatonicMove({ step: "A", alter: 1, octave: 4 }, 3, 1)), "B4");
  assert.equal(spell(chromaticMove({ step: "A", alter: 0, octave: 4 }, 1)), "A#4");
  assert.equal(spell(chromaticMove({ step: "A", alter: 0, octave: 4 }, -1)), "Ab4");
  assert.equal(spell(chromaticMove({ step: "E", alter: 0, octave: 4 }, 1)), "E#4");
  assert.equal(staffStep("A", 4, "G"), 3);
  assert.equal(staffStep("A", 3, "F"), 8);
  const mix = defaultMix("S");
  assert.equal(mix.S, 1);
  assert.ok(Math.abs(mix.A - 10 ** (-10 / 20)) < 1e-12);
  assert.ok(Math.abs(mix.T - 10 ** (-10 / 20)) < 1e-12);
  assert.ok(Math.abs(mix.P - 10 ** (-11 / 20)) < 1e-12);
  assert.equal(editedName("Song - A - Piano Vocal.musicxml"), "Song - A - Piano Vocal (edited).musicxml");
});

test("fixture has SA and TB voices, chords, and a two-staff piano part", () => {
  const score = load();
  assert.equal(score.quarterBpm, 68);
  assert.deepEqual(
    score.parts.map((p) => p.role),
    ["SA", "TB", "piano"],
  );
  const sa = score.parts[0];
  const tb = score.parts[1];
  const piano = score.parts[2];
  assert.equal(sa.measures.length, 4);
  assert.equal(tb.measures.length, 4);
  assert.equal(piano.measures.length, 4);
  assert.deepEqual(sa.measures[0].notes[0].parts, ["S", "A"]);
  assert.equal(sa.measures[0].harmonies[0].text, "A");
  assert.equal(sa.measures[1].harmonies[0].text, "D");
  assert.equal(sa.measures[1].harmonies[1].text, "E/G#");
  assert.equal(sa.measures[1].harmonies[1].ql, 2);
  assert.equal(sa.measures[2].harmonies[0].text, "F#m7");
  assert.equal(sa.measures[1].clef.sign, "G");
  assert.equal(tb.measures[0].clef.sign, "F");
  assert.ok(sa.measures[1].notes.some((n) => n.voice === "2"));
  assert.ok(tb.measures[1].notes.some((n) => n.voice === "2"));
  assert.ok(piano.measures[0].notes.some((n) => n.chord));
  assert.ok(piano.measures[0].notes.some((n) => n.voice === "5"));
  const alto = sa.measures[1].notes.find((n) => n.parts[0] === "A");
  assert.equal(isUnison(alto, sa.measures[1]), true);
});

test("an unedited export is byte-identical, including both pitch indent styles", () => {
  const score = load();
  assert.equal(exportScore(score), fixtureXml);
  for (const note of iterNotes(score)) {
    if (!note.pitchRange) continue;
    const block = fixtureXml.slice(note.pitchRange.start, note.pitchRange.end);
    assert.equal(updatePitchBlock(block, note.pitch), block, note.id);
  }
});

test("three edits in different parts, one of them a unison, change only those pitches", () => {
  const before = load();
  const picked = pickThree(before);
  const plan = picked.map((row) => {
    const next = diatonicMove(row.note.pitch, row.fifths, row.dir);
    return { id: row.note.id, parts: [...row.note.parts], before: { ...row.note.pitch }, after: next, dir: row.dir };
  });
  assert.deepEqual(
    plan.map((p) => p.parts[0]),
    ["S", "A", "T"],
  );
  assert.equal(isUnison(findNote(before, plan[1].id).note, findNote(before, plan[1].id).measure), true);
  for (const step of plan) setPitch(before, step.id, step.after);

  const afterXml = exportScore(before);
  assert.notEqual(afterXml, fixtureXml);
  const after = parseScore(afterXml);
  for (const step of plan) {
    assert.deepEqual(findNote(after, step.id).note.pitch, step.after);
    assert.equal(isEdited(findNote(before, step.id).note), true);
  }
  for (const note of iterNotes(after)) {
    if (plan.some((p) => p.id === note.id) || !note.pitch) continue;
    assert.equal(pitchSlice(afterXml, after, note.id), pitchSlice(fixtureXml, before, note.id), note.id);
  }
  const beforeRanges = plan.map((p) => findNote(parseScore(fixtureXml), p.id).note.pitchRange);
  const afterRanges = plan.map((p) => findNote(after, p.id).note.pitchRange);
  assert.equal(cutRanges(afterXml, afterRanges), cutRanges(fixtureXml, beforeRanges));
  assert.equal(afterXml.includes("<accidental"), fixtureXml.includes("<accidental"));
  assert.equal(afterXml.split("<accidental").length, fixtureXml.split("<accidental").length);
  // Restoring the three pitches restores every byte.
  for (const step of plan) setPitch(before, step.id, step.before);
  assert.equal(exportScore(before), fixtureXml);
});

test("a chromatic edit writes the accidental it needs and a canceling one later in the bar", () => {
  const score = load();
  const measure = score.parts[0].measures[2];
  const pair = measure.notes.filter((n) => n.parts.length === 1 && n.parts[0] === "S" && n.pitch?.step === "A");
  assert.ok(pair.length >= 2);
  const [first, second, third] = pair;
  const flat = chromaticMove(first.pitch, -1);
  assert.equal(spell(flat), "Ab4");
  setPitch(score, first.id, flat);
  const xml = exportScore(score);
  const after = parseScore(xml);
  assert.equal(findNote(after, first.id).note.accidental, "flat");
  assert.equal(findNote(after, second.id).note.accidental, "natural");
  assert.equal(findNote(after, third.id).note.accidental, null);
  assert.equal(pitchSlice(xml, after, second.id), pitchSlice(fixtureXml, score, second.id));
  const beforeRanges = [findNote(parseScore(fixtureXml), first.id).note.pitchRange];
  const edited = parseScore(xml);
  const afterRanges = [
    findNote(edited, first.id).note.pitchRange,
    lineRange(xml, findNote(edited, first.id).note.accidentalRange),
    lineRange(xml, findNote(edited, second.id).note.accidentalRange),
  ];
  assert.equal(cutRanges(xml, afterRanges), cutRanges(fixtureXml, beforeRanges));
});

function lineRange(xml, range) {
  let start = range.start;
  const line = xml.lastIndexOf("\n", start - 1);
  if (line >= 0 && xml.slice(line + 1, start).trim() === "") start = line;
  return { start, end: range.end };
}

test("playback uses quarter lengths, doubles merged unisons, and holds ties", () => {
  const events = playbackEvents(load());
  const a4 = events.filter((e) => e.ql === 0 && e.midi === 69);
  assert.deepEqual(
    a4.map((e) => e.channel).sort(),
    ["A", "S"],
  );
  assert.equal(a4[0].durQl, 1);
  const tied = events.find((e) => e.channel === "S" && e.ql === 7 && e.midi === 69);
  assert.equal(tied.durQl, 2);
  assert.equal(
    events.some((e) => e.channel === "S" && e.ql === 8 && e.midi === 69),
    false,
  );
  const chord = events.filter((e) => e.channel === "P" && e.ql === 0).map((e) => e.midi).sort((a, b) => a - b);
  // Right-hand A major plus the left-hand A that starts on the same beat.
  assert.deepEqual(chord, [45, 57, 61, 64]);
});

function proveFile(xml, label) {
  const score = parseScore(xml);
  assert.equal(exportScore(score), xml, `${label} unedited export`);
  for (const note of iterNotes(score)) {
    if (!note.pitchRange) continue;
    const block = xml.slice(note.pitchRange.start, note.pitchRange.end);
    assert.equal(updatePitchBlock(block, note.pitch), block, `${label} ${note.id}`);
  }
  const roles = score.parts.map((p) => p.role);
  assert.ok(roles.includes("SA") && roles.includes("TB") && roles.includes("piano"), label);
  const working = parseScore(xml);
  const picked = pickThree(working);
  const originals = picked.map((row) => ({ ...row.note.pitch }));
  for (const row of picked) setPitch(working, row.note.id, diatonicMove(row.note.pitch, row.fifths, row.dir));
  const edited = exportScore(working);
  const after = parseScore(edited);
  const ids = picked.map((row) => row.note.id);
  const beforeRanges = ids.map((id) => findNote(parseScore(xml), id).note.pitchRange);
  const afterRanges = ids.map((id) => findNote(after, id).note.pitchRange);
  assert.equal(cutRanges(edited, afterRanges), cutRanges(xml, beforeRanges), `${label} masked diff`);
  assert.equal(edited.split("<accidental").length, xml.split("<accidental").length, `${label} accidentals`);
  const report = pitchReport(xml, parseScore(xml), edited, after, ids);
  for (const row of picked) setPitch(working, row.note.id, originals[picked.indexOf(row)]);
  assert.equal(exportScore(working), xml, `${label} undo`);
  return { score, report, ids };
}

test("local Piano Vocal file round-trips when REAL_MUSICXML is set", () => {
  const path = process.env.REAL_MUSICXML;
  if (!path) return;
  const xml = readFileSync(path, "utf8");
  const { score, report } = proveFile(xml, "real");
  const sa = score.parts.find((p) => p.role === "SA");
  const tb = score.parts.find((p) => p.role === "TB");
  assert.ok(sa.measures.length >= 8, "real measure count");
  assert.equal(tb.measures.length, sa.measures.length);
  assert.ok(iterNotes(score).filter((n) => n.pitch).length > 1000);
  console.log("REAL ROUND TRIP");
  console.log(`parts ${score.parts.map((p) => `${p.role}:${p.measures.length}`).join(" ")}`);
  console.log(`tempo ${score.quarterBpm} title-chars ${score.title.length}`);
  for (const line of report) console.log(line);
  console.log(`bytes in ${xml.length} out ${exportScore(parseScore(xml)).length}`);
});
