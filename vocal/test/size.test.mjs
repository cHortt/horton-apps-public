import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zipSync } from "../js/fflate.mjs";
import { addParts, removePart, setMelodyNotes, setStackCover, setUnisonNotes } from "../js/edit.mjs";
import { exportMscz, msczReplacements, openMscz } from "../js/mscz.mjs";
import { PART_NAMES, exportScore, iterNotes, parseScore, playbackEvents, scoreReplacements } from "../js/musicxml.mjs";
import { renderScore } from "../js/render.mjs";
import { pitchToMidi } from "../js/theory.mjs";
import { entryData, readZip, writeZip } from "../js/zip.mjs";

const encoder = new TextEncoder();

function pack(xml) {
  const text = (value) => encoder.encode(value);
  const files = {
    "score_style.mss": text(`<museScore version="3.02"><Style><pageWidth>8.5</pageWidth></Style></museScore>`),
    "sat2.mscx": text(xml),
    "Thumbnails/thumbnail.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    "META-INF/container.xml": text(`<container><rootfiles><rootfile full-path="sat2.mscx"/></rootfiles></container>`),
  };
  return writeZip(
    Object.entries(files).map(([name, data]) => ({
      name,
      nameBytes: text(name),
      data,
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

const MS3 = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="3.02">
  <programVersion>3.6.2</programVersion>
  <Score>
    <Division>480</Division>
    <Part>
      <Staff id="1"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName></trackName>
      <Instrument id="voice"><longName>Voice</longName><instrumentId>voice.vocals</instrumentId></Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType></Clef>
          <KeySig><concertKey>0</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Chord>
            <durationType>quarter</durationType>
            <Lyrics><text>la</text></Lyrics>
            <Note><pitch>60</pitch><tpc>14</tpc><small>1</small></Note>
            <Note><pitch>64</pitch><tpc>18</tpc></Note>
            <Note><pitch>67</pitch><tpc>15</tpc><small>1</small></Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note><pitch>72</pitch><tpc>14</tpc></Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note><pitch>71</pitch><tpc>19</tpc></Note>
            <Note><pitch>74</pitch><tpc>16</tpc><small>1</small></Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note><pitch>55</pitch><tpc>15</tpc><small>1</small></Note>
            <Note><pitch>60</pitch><tpc>14</tpc></Note>
          </Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Chord>
            <durationType>half</durationType>
            <Note><pitch>64</pitch><tpc>18</tpc><small>1</small></Note>
            <Note><pitch>67</pitch><tpc>15</tpc></Note>
            <Note>
              <Spanner type="Tie"><Tie></Tie><next><location><measures>1</measures><fractions>0/1</fractions></location></next></Spanner>
              <pitch>71</pitch><tpc>19</tpc><small>1</small>
            </Note>
          </Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Chord>
            <durationType>half</durationType>
            <Note><pitch>64</pitch><tpc>18</tpc><small>1</small></Note>
            <Note><pitch>67</pitch><tpc>15</tpc></Note>
            <Note>
              <Spanner type="Tie"><Tie></Tie><prev><location><measures>-1</measures><fractions>0/1</fractions></location></prev></Spanner>
              <pitch>71</pitch><tpc>19</tpc><small>1</small>
            </Note>
          </Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type size="cue">quarter</type>
        <stem>up</stem>
        <lyric><text>la</text></lyric>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>up</stem>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type size="cue">quarter</type>
        <stem>up</stem>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note>
        <chord/>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type size="cue">quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type size="cue">quarter</type>
      </note>
      <note>
        <chord/>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
`;

const STACK = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20">
  <programVersion>4.2.1</programVersion>
  <Score>
    <Division>480</Division>
    <Part id="1">
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Vocals</trackName>
      <Instrument id="voice"><instrumentId>voice.ensemble</instrumentId></Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <KeySig><concertKey>0</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Rest><durationType>quarter</durationType></Rest>
          <Chord><durationType>quarter</durationType><Note><pitch>56</pitch><tpc>21</tpc></Note><Note><pitch>59</pitch><tpc>19</tpc></Note></Chord>
          <Chord><durationType>half</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

function pitches(notes) {
  return notes.filter((note) => note.pitch).map((note) => `${note.parts.join("+")}:${note.pitch.step}${note.pitch.octave}${note.unison ? ":u" : ""}`);
}

function assertSplicesStayIn(xml, edited, reps, spans) {
  const sorted = [...reps].sort((a, b) => a.start - b.start || a.end - b.end);
  let end = -1;
  for (const rep of sorted) {
    assert.ok(rep.start >= end, "overlapping splices");
    end = Math.max(end, rep.end);
    assert.ok(
      spans.some((span) => rep.start >= span.start && rep.end <= span.end),
      `splice outside the chord (${rep.kind || ""})`,
    );
  }
  let out = "";
  let cursor = 0;
  for (const rep of [...reps].sort((a, b) => a.start - b.start || a.end - b.end)) {
    out += xml.slice(cursor, rep.start);
    out += rep.text;
    cursor = rep.end;
  }
  out += xml.slice(cursor);
  assert.equal(out, edited);
}

test("the editing controls are in the page", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["scope-chord", "scope-bar", "add-high", "add-low", "remove-part", "make-melody", "unison", "ambiguous"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /MuseScore 3 or 4/);
  assert.match(html, />Soprano</);
  assert.match(html, />Alto</);
  assert.match(html, />Tenor</);
  assert.match(html, /Add Soprano/);
  assert.match(html, /Add Tenor/);
  assert.match(html, /Soprano and Tenor/);
  assert.doesNotMatch(html, />Melody</);
  assert.doesNotMatch(html, />High</);
  assert.doesNotMatch(html, />Low</);
});

test("a size-convention file puts the melody on Alto, the upper cue on Soprano, and the lower cue on Tenor", () => {
  const packed = pack(MS3);
  const score = openMscz(packed);
  assert.equal(score.parts[0].convention, "size");
  const notes = score.parts[0].measures[0].notes.filter((note) => note.pitch);
  assert.deepEqual(pitches(notes), ["T:C4", "A:E4", "S:G4", "A:C5", "A:B4", "S:D5", "T:G3", "A:C4"]);
  const chord = notes.filter((note) => note.startQl === 0);
  const melody = chord.find((note) => !note.small);
  const cues = chord.filter((note) => note.small).sort((a, b) => pitchToMidi(b.pitch) - pitchToMidi(a.pitch));
  assert.equal(PART_NAMES[melody.parts[0]], "Alto");
  assert.equal(melody.lyric.text, "la");
  assert.equal(PART_NAMES[cues[0].parts[0]], "Soprano");
  assert.equal(PART_NAMES[cues[1].parts[0]], "Tenor");
  assert.equal(notes.filter((note) => note.ambiguous).length, 0);
  const view = renderScore(score, { activePart: "S", selectedId: notes[2].id, showChanges: false, playMeasure: 0 });
  assert.match(view.music, /rx="4.176"/);
  assert.doesNotMatch(view.music, />\?</);
});

test("a pre-change size file exports the same layout", () => {
  const packed = pack(MS3);
  const score = openMscz(packed);
  const again = readZip(exportMscz(score));
  const original = readZip(packed);
  for (let i = 0; i < original.length; i++) assert.deepEqual(again[i].compressed, original[i].compressed, original[i].name);
  assert.equal(exportScore(parseScore(XML)), XML);
});

test("a lone small note is Soprano above the melody and Tenor otherwise", () => {
  const score = openMscz(pack(MS3));
  const above = score.parts[0].measures[0].notes.filter((note) => note.startQl === 2);
  assert.deepEqual(above.map((note) => note.parts[0]), ["A", "S"]);
  const below = score.parts[0].measures[0].notes.filter((note) => note.startQl === 3);
  assert.deepEqual(below.map((note) => note.parts[0]), ["T", "A"]);
  const xmlScore = parseScore(XML);
  assert.equal(xmlScore.parts[0].convention, "size");
  assert.deepEqual(
    xmlScore.parts[0].measures[0].notes.filter((note) => note.pitch).map((note) => note.parts[0]),
    ["T", "A", "S", "A", "A", "S", "T", "A"],
  );
  assert.equal(exportScore(xmlScore), XML);
});

test("size edits rewrite only the chords they touch", () => {
  const packed = pack(MS3);
  const score = openMscz(packed);
  const melodyOnly = score.parts[0].measures[0].notes.find((note) => note.pitch?.octave === 5);
  addParts(score, [score.parts[0].measures[0].notes.filter((note) => note.startQl === melodyOnly.startQl)], ["S", "T"]);
  let reps = msczReplacements(score);
  let xml = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => entry.name.endsWith(".mscx"))));
  assertSplicesStayIn(MS3, xml, reps, [melodyOnly.chordSpan]);
  assert.equal(xml.split("<small>1</small>").length, MS3.split("<small>1</small>").length + 2);
  const added = openMscz(exportMscz(score));
  const chord = added.parts[0].measures[0].notes.filter((note) => note.startQl === 1);
  assert.deepEqual(chord.map((note) => note.parts[0]).sort(), ["A", "S", "T"]);

  const low = score.parts[0].measures[0].notes.find((note) => note.parts[0] === "T" && note.startQl === 0);
  removePart(score, [score.parts[0].measures[0].notes.filter((note) => note.startQl === 0)], "T");
  reps = msczReplacements(score);
  xml = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => entry.name.endsWith(".mscx"))));
  const spans = score.parts[0].measures[0].notes.filter((note) => note.startQl === 0 || note.startQl === 1).map((note) => note.chordSpan);
  assertSplicesStayIn(MS3, xml, reps, spans);
  assert.equal(openMscz(exportMscz(score)).parts[0].measures[0].notes.filter((note) => note.startQl === 0 && note.parts[0] === "T").length, 0);

  const high = score.parts[0].measures[0].notes.find((note) => note.parts[0] === "S" && note.startQl === 0);
  setMelodyNotes(score, [score.parts[0].measures[0].notes.filter((note) => note.startQl === 0)], "S");
  reps = msczReplacements(score);
  xml = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => entry.name.endsWith(".mscx"))));
  assert.ok(reps.every((rep) => rep.kind === "small" || rep.kind === "insert" || rep.kind === "delete-note"));
  const flipped = openMscz(exportMscz(score)).parts[0].measures[0].notes.filter((note) => note.startQl === 0);
  assert.equal(flipped.find((note) => note.pitch.step === "G").parts[0], "A");
  assert.equal(flipped.find((note) => note.pitch.step === "E").small, true);

  const fresh = openMscz(pack(MS3));
  const harmony = fresh.parts[0].measures[1].notes.find((note) => note.small);
  setUnisonNotes(fresh, [fresh.parts[0].measures[1].notes.filter((note) => note.pitch)], "S");
  const unisonXml = new TextDecoder().decode(entryData(readZip(exportMscz(fresh)).find((entry) => entry.name.endsWith(".mscx"))));
  assert.match(unisonXml, /<small>1<\/small>\s*<visible>0<\/visible>/);
  const back = openMscz(exportMscz(fresh));
  const marked = back.parts[0].measures[1].notes.find((note) => note.unison);
  assert.equal(marked.parts[0], "S");
  assert.equal(pitchToMidi(marked.pitch), pitchToMidi(back.parts[0].measures[1].notes.find((note) => note.parts[0] === "A").pitch));
  assert.match(renderScore(back, { activePart: "S", selectedId: marked.id, showChanges: false, playMeasure: 1 }).music, /Soprano unison/);
  assert.equal(harmony.small, true);
});

test("removing a tied small note strips only that tie", () => {
  const score = openMscz(pack(MS3));
  const chord = score.parts[0].measures[1].notes.filter((note) => note.pitch);
  removePart(score, [chord], "S");
  const reps = msczReplacements(score);
  assert.ok(reps.some((rep) => rep.kind === "delete-note"));
  assert.ok(reps.some((rep) => rep.kind === "tie"));
  const xml = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => entry.name.endsWith(".mscx"))));
  const partner = score.parts[0].measures[2].notes.find((note) => note.stripTies);
  assertSplicesStayIn(MS3, xml, reps, [chord[0].chordSpan, partner.elementSpan]);
  assert.equal((xml.match(/<Spanner type="Tie">/g) || []).length, 0);
});

test("MusicXML cue notes round-trip the same edits", () => {
  const score = parseScore(XML);
  const first = score.parts[0].measures[0].notes.filter((note) => note.startQl === 0);
  removePart(score, [first], "T");
  const reps = scoreReplacements(score);
  const xml = exportScore(score);
  assertSplicesStayIn(XML, xml, reps, [first[0].chordSpan]);
  assert.equal((xml.match(/<chord\/>/g) || []).length, XML.match(/<chord\/>/g).length - 1);
  const reloaded = parseScore(xml);
  assert.deepEqual(
    reloaded.parts[0].measures[0].notes.filter((note) => note.startQl === 0).map((note) => note.parts[0]),
    ["A", "S"],
  );
  const melodyOnly = reloaded.parts[0].measures[0].notes.filter((note) => note.startQl === 1);
  addParts(reloaded, [melodyOnly], ["S"]);
  const addedXml = exportScore(reloaded);
  assert.match(addedXml, /print-object|size="cue"/);
  const withHigh = parseScore(addedXml);
  assert.equal(withHigh.parts[0].measures[0].notes.find((note) => note.startQl === 1 && note.small).parts[0], "S");
  setUnisonNotes(withHigh, [withHigh.parts[0].measures[0].notes.filter((note) => note.startQl === 1)], "S");
  const unison = exportScore(withHigh);
  assert.match(unison, /print-object="no"/);
  assert.match(unison, /<type size="cue">/);
  const heard = parseScore(unison);
  const badge = heard.parts[0].measures[0].notes.find((note) => note.unison);
  assert.ok(badge);
  assert.match(renderScore(heard, { activePart: "T", selectedId: badge.id, showChanges: false, playMeasure: 0 }).music, /unison/);
  const events = playbackEvents(heard).filter((event) => event.ql === 1);
  assert.ok(events.some((event) => event.channel === badge.parts[0]));
});

test("a stacked two-note chord is ambiguous and the choice is not written into the file", () => {
  const packed = pack(STACK);
  const score = openMscz(packed);
  assert.equal(score.parts[0].convention, "legacy");
  const chord = score.parts[0].measures[0].notes.filter((note) => note.pitch && note.startQl === 1);
  assert.deepEqual(chord.map((note) => note.parts[0]), ["S", "A"]);
  assert.ok(chord.every((note) => note.ambiguous));
  assert.equal(chord[0].stackLower, true);
  const view = renderScore(score, { activePart: "S", selectedId: chord[0].id, showChanges: false, playMeasure: 0 });
  assert.match(view.music, />\?</);
  setStackCover([chord], ["S", "T"]);
  assert.deepEqual(chord[0].parts, ["S", "T"]);
  const channels = playbackEvents(score).filter((event) => event.ql === 1).map((event) => event.channel).sort();
  assert.deepEqual(channels, ["A", "S", "T"]);
  const again = readZip(exportMscz(score));
  const original = readZip(packed);
  for (let i = 0; i < original.length; i++) assert.deepEqual(again[i].compressed, original[i].compressed);
  assert.equal(msczReplacements(score).length, 0);
});

test("an unrelated zip entry is not repacked when a small note is added", () => {
  const packed = zipSync({ "sat2.mscx": encoder.encode(MS3), "audiosettings.json": encoder.encode("{}\n") });
  const score = openMscz(packed);
  const chord = score.parts[0].measures[0].notes.filter((note) => note.startQl === 1);
  addParts(score, [chord], ["T"]);
  const out = readZip(exportMscz(score));
  const before = readZip(packed);
  assert.deepEqual(out.find((entry) => entry.name.endsWith(".json")).compressed, before.find((entry) => entry.name.endsWith(".json")).compressed);
});
