import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { channelsForScore, playbackMix } from "../js/mix.mjs";
import { exportMscz, openMscz } from "../js/mscz.mjs";
import { NEEDS_VOCAL_ERROR, exportScore, parseScore, setPitch } from "../js/musicxml.mjs";
import { preparePlayback } from "../js/playback.mjs";
import { renderScore } from "../js/render.mjs";
import { pitchToMidi } from "../js/theory.mjs";
import { entryData, readZip, writeZip } from "../js/zip.mjs";

const encoder = new TextEncoder();
const text = (value) => encoder.encode(value);

function pack(xml) {
  return writeZip(
    ["score.mscx"].map((name) => ({
      name,
      nameBytes: text(name),
      data: text(xml),
      flag: 2048,
      time: 0,
      date: 0,
      localExtra: new Uint8Array(0),
      centralExtra: new Uint8Array(0),
      comment: new Uint8Array(0),
      versionMade: 20,
      versionNeeded: 20,
      internalAttr: 0,
      externalAttr: 0,
    })),
  );
}

function pitched(part) {
  return part.measures.flatMap((measure) => measure.notes.filter((note) => note.pitch && !note.grace));
}

function partSlice(xml, id) {
  const start = xml.indexOf(`<part id="${id}">`);
  const end = xml.indexOf("</part>", start);
  return xml.slice(start, end + "</part>".length);
}

function staffSlices(xml, id) {
  const re = new RegExp(`<Staff id="${id}">[\\s\\S]*?</Staff>`, "g");
  return [...xml.matchAll(re)].map((match) => match[0]);
}

const FIXTURE = readFileSync(new URL("../fixtures/sat-piano.musicxml", import.meta.url), "utf8");

test("a combined SAT and piano file edits the vocal lines and plays the piano", () => {
  const score = parseScore(FIXTURE);
  assert.equal(exportScore(score), FIXTURE);
  assert.deepEqual(
    score.parts.map((part) => part.role),
    ["SA", "piano"],
  );
  const vocal = score.parts[0];
  const piano = score.parts[1];
  assert.equal(vocal.convention, "size");
  assert.equal(vocal.staffLabel, "Vocal");
  const notes = pitched(vocal);
  const full = notes.filter((note) => !note.small);
  const upper = notes.find((note) => note.small && note.pitch.step === "E");
  const lower = notes.find((note) => note.small && note.pitch.step === "G");
  assert.deepEqual(full.map((note) => note.parts[0]), ["S"]);
  assert.deepEqual(upper.parts, ["A"]);
  assert.deepEqual(lower.parts, ["T"]);
  assert.ok(pitched(piano).every((note) => note.parts.length === 0));
  assert.equal(piano.measures[0].notes.find((note) => note.lyric)?.pitch.step, "A");
  const played = preparePlayback(score, null).events.filter((event) => event.channel === "P");
  assert.deepEqual(played.map((event) => event.midi).sort((a, b) => a - b), [54, 69]);
  assert.ok(channelsForScore(score).includes("P"));
  const pianoOff = playbackMix({ S: 0, A: 0, T: 0, B: 0, P: null });
  assert.equal(pianoOff.mutes.P, true);
  assert.equal(pianoOff.gains.P, 0);
  assert.ok(played.every((event) => pianoOff.mutes[event.channel]));
  const view = renderScore(score, { activePart: "S", selectedId: null, showChanges: false, playMeasure: 0 });
  assert.doesNotMatch(view.gutter, />TB</);
  assert.ok(view.notes.filter((note) => !note.isRest).every((note) => note.parts.length > 0));

  const melody = full[0];
  setPitch(score, melody.id, { step: "D", alter: 0, octave: 4 });
  const out = exportScore(score);
  assert.equal(partSlice(out, "P2"), partSlice(FIXTURE, "P2"));
  assert.match(out, /<step>D<\/step>/);
  const again = parseScore(out);
  const edited = pitched(again.parts[0]).find((note) => !note.small);
  assert.equal(edited.pitch.step, "D");
  assert.deepEqual(edited.parts, ["S"]);
  assert.deepEqual(
    pitched(again.parts[1]).map((note) => pitchToMidi(note.pitch)).sort((a, b) => a - b),
    [54, 69],
  );
});

test("a vocal-only file plays chord symbols, and a piano-only file is refused", () => {
  const vocalOnly = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
  const chords = preparePlayback(parseScore(vocalOnly), null).events.filter((event) => event.channel === "P");
  assert.ok(chords.some((event) => event.midi === 67));
  assert.equal(parseScore(vocalOnly).parts.some((part) => part.role === "piano"), false);

  const pianoOnly = FIXTURE.replace(/<score-part id="P1">[\s\S]*?<\/score-part>/, "").replace(/<part id="P1">[\s\S]*?<\/part>/, "");
  assert.throws(() => parseScore(pianoOnly), new RegExp(NEEDS_VOCAL_ERROR.replace(/[.]/g, "\\.")));
});

test("a piano instrument name keeps both hands out of the vocal line", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Staff</part-name></score-part>
    <score-part id="P2">
      <part-name>Grand Staff</part-name>
      <score-instrument id="P2-I1"><instrument-name>Piano</instrument-name></score-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <lyric><text>ah</text></lyric>
      </note>
      <backup><duration>1</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const score = parseScore(xml);
  assert.deepEqual(score.parts.map((part) => part.role), ["SA", "piano"]);
  assert.ok(pitched(score.parts[1]).every((note) => note.parts.length === 0));
  const events = preparePlayback(score, null).events;
  assert.ok(events.some((event) => event.channel === "P" && event.midi === 76));
  assert.equal(events.some((event) => event.channel !== "P" && event.midi === 76), false);
});

const MSCZ_SAT = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <programVersion>3.6.2</programVersion>
  <Score>
    <Division>480</Division>
    <Part id="1">
      <Staff id="1"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Vocals (SAT)</trackName>
      <Instrument id="voice"><longName>Vocals (SAT)</longName><shortName>Vox.</shortName><instrumentId>voice.vocals</instrumentId></Instrument>
    </Part>
    <Part id="2">
      <Staff id="2"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <Staff id="3"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Piano</trackName>
      <Instrument id="piano"><longName>Piano</longName><shortName>Pno.</shortName><instrumentId>keyboard.piano</instrumentId></Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType></Clef>
          <Chord>
            <durationType>quarter</durationType>
            <Lyrics><text>la</text></Lyrics>
            <Note><pitch>55</pitch><tpc>15</tpc><small>1</small></Note>
            <Note><pitch>60</pitch><tpc>14</tpc></Note>
            <Note><pitch>64</pitch><tpc>18</tpc><small>1</small></Note>
          </Chord>
        </voice>
      </Measure>
    </Staff>
    <Staff id="2">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType></Clef>
          <Chord><durationType>quarter</durationType><Lyrics><text>ah</text></Lyrics><Note><pitch>69</pitch><tpc>17</tpc></Note></Chord>
        </voice>
      </Measure>
    </Staff>
    <Staff id="3">
      <Measure>
        <voice>
          <Clef><concertClefType>F</concertClefType></Clef>
          <Chord><durationType>quarter</durationType><Note><Accidental><subtype>accidentalSharp</subtype></Accidental><pitch>54</pitch><tpc>20</tpc></Note></Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

test("a MuseScore SAT staff plus piano grand staff round-trips the piano bytes", () => {
  const packed = pack(MSCZ_SAT);
  const score = openMscz(packed);
  assert.deepEqual(score.parts.map((part) => part.role), ["SA", "piano"]);
  assert.equal(score.parts[0].convention, "size");
  const notes = pitched(score.parts[0]);
  assert.equal(notes.find((note) => pitchToMidi(note.pitch) === 60).parts[0], "S");
  assert.equal(notes.find((note) => pitchToMidi(note.pitch) === 64).parts[0], "A");
  assert.equal(notes.find((note) => pitchToMidi(note.pitch) === 55).parts[0], "T");
  assert.ok(pitched(score.parts[1]).every((note) => note.parts.length === 0));
  const played = preparePlayback(score, null).events.filter((event) => event.channel === "P").map((event) => event.midi);
  assert.deepEqual(played.sort((a, b) => a - b), [54, 69]);
  const melody = notes.find((note) => pitchToMidi(note.pitch) === 60);
  setPitch(score, melody.id, { step: "D", alter: 0, octave: 4 });
  const out = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => /\.mscx$/i.test(entry.name))));
  assert.deepEqual(staffSlices(out, "2"), staffSlices(MSCZ_SAT, "2"));
  assert.deepEqual(staffSlices(out, "3"), staffSlices(MSCZ_SAT, "3"));
  assert.match(out, /<pitch>62<\/pitch>/);
  const again = openMscz(exportMscz(score));
  assert.equal(pitchToMidi(pitched(again.parts[0]).find((note) => note.parts[0] === "S").pitch), 62);
  assert.deepEqual(pitched(again.parts[1]).map((note) => pitchToMidi(note.pitch)).sort((a, b) => a - b), [54, 69]);
});

test("a MuseScore file that is only a piano grand staff needs a vocal staff", () => {
  const piano = MSCZ_SAT.replace(/<Part id="1">[\s\S]*?<\/Part>/, "").replace(/<Staff id="1">[\s\S]*?<\/Staff>/, "");
  assert.throws(() => openMscz(pack(piano)), new RegExp(NEEDS_VOCAL_ERROR.replace(/[.]/g, "\\.")));
});

test("Piano Vocal names keep Solo, Soprano/Alto, and Tenor/Bass vocal and the piano as piano", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Solo</part-name></score-part>
    <score-part id="P2"><part-name>Soprano/Alto</part-name></score-part>
    <score-part id="P3"><part-name>Tenor/Bass</part-name></score-part>
    <score-part id="P4"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part>
  <part id="P2"><measure number="1"><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note><note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure></part>
  <part id="P3"><measure number="1"><note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note></measure></part>
  <part id="P4"><measure number="1"><attributes><staves>2</staves></attributes><note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note><backup><duration>1</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note></measure></part>
</score-partwise>`;
  const score = parseScore(xml);
  assert.deepEqual(score.parts.map((part) => [part.role, part.name]), [
    ["other", "Solo"],
    ["SA", "Soprano/Alto"],
    ["TB", "Tenor/Bass"],
    ["piano", "Piano"],
  ]);
  assert.ok(pitched(score.parts[3]).every((note) => note.parts.length === 0));
  const events = preparePlayback(score, null).events;
  assert.ok(events.some((event) => event.channel === "P" && event.midi === 69));
  assert.equal(events.some((event) => event.channel !== "P" && event.midi === 69), false);
  renderScore(score, { activePart: "S", selectedId: null, showChanges: false, playMeasure: 0 });

  const mscz = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <Score>
    <Division>480</Division>
    <Part><Staff id="1"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><trackName>Solo</trackName><Instrument><longName>Solo</longName></Instrument></Part>
    <Part><Staff id="2"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><trackName>Soprano/Alto</trackName><Instrument><longName>Soprano/Alto</longName></Instrument></Part>
    <Part><Staff id="3"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><trackName>Tenor/Bass</trackName><Instrument><longName>Tenor/Bass</longName></Instrument></Part>
    <Part><Staff id="4"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><Staff id="5"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><trackName>Piano</trackName><Instrument><longName>Piano</longName></Instrument></Part>
    <Staff id="1"><Measure><voice><Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord></voice></Measure></Staff>
    <Staff id="2"><Measure><voice><Chord><durationType>quarter</durationType><Note><pitch>64</pitch><tpc>18</tpc></Note></Chord></voice></Measure></Staff>
    <Staff id="3"><Measure><voice><Chord><durationType>quarter</durationType><Note><pitch>55</pitch><tpc>15</tpc></Note></Chord></voice></Measure></Staff>
    <Staff id="4"><Measure><voice><Clef><concertClefType>G</concertClefType></Clef><Chord><durationType>quarter</durationType><Note><pitch>69</pitch><tpc>17</tpc></Note></Chord></voice></Measure></Staff>
    <Staff id="5"><Measure><voice><Clef><concertClefType>F</concertClefType></Clef><Chord><durationType>quarter</durationType><Note><pitch>48</pitch><tpc>14</tpc></Note></Chord></voice></Measure></Staff>
  </Score>
</museScore>`;
  const opened = openMscz(pack(mscz));
  assert.deepEqual(opened.parts.map((part) => [part.role, part.name]), [
    ["SA", "Solo"],
    ["TB", "Soprano/Alto"],
    ["extra", "Tenor/Bass"],
    ["piano", "Piano"],
  ]);
  assert.ok(pitched(opened.parts[3]).every((note) => note.parts.length === 0));
  assert.ok(preparePlayback(opened, null).events.some((event) => event.channel === "P" && event.midi === 69));
  assert.equal(preparePlayback(opened, null).events.some((event) => event.channel !== "P" && event.midi === 69), false);
});
