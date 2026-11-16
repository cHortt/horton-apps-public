import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { zipSync } from "../js/fflate.mjs";
import { chromaticMove, diatonicMove, pitchToMidi } from "../js/theory.mjs";
import { exportMscz, openMscz, pitchFromMidiTpc, tpcFromPitch } from "../js/mscz.mjs";
import { editedName, exportScore, isEdited, iterNotes, parseScore, playbackEvents, setPitch } from "../js/musicxml.mjs";
import { renderScore } from "../js/render.mjs";
import { crc32, entryData, readZip, writeZip } from "../js/zip.mjs";

const encoder = new TextEncoder();

function text(value) {
  return encoder.encode(value);
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

function changedSpans(note) {
  return [note.pitchSpan, note.tpcSpan, note.tpc2Span, note.accidentalSpan].filter(Boolean);
}

function pack(xml, extras = {}) {
  const files = {
    "score_style.mss": text(`<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="4.20">\n  <Style><hideInstrumentName>1</hideInstrumentName><pageWidth>8.5</pageWidth></Style>\n</museScore>\n`),
    "sample.mscx": text(xml),
    "Thumbnails/thumbnail.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 10]),
    "automation.json": text("[]"),
    "audiosettings.json": text('{"tracks":[]}\n'),
    "viewsettings.json": text('{"notation":{"viewMode":"page"}}\n'),
    "META-INF/container.xml": text(
      '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="sample.mscx"/></rootfiles></container>\n',
    ),
    ...extras,
  };
  const entries = Object.entries(files).map(([name, data]) => ({
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
  }));
  return writeZip(entries);
}

const STACK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20">
  <programVersion>4.2.1</programVersion>
  <Score>
    <Division>480</Division>
    <metaTag name="workTitle">Sample</metaTag>
    <Part id="1">
      <Staff>
        <StaffType group="pitched"><name>stdNormal</name></StaffType>
      </Staff>
      <trackName>Vocals</trackName>
      <Instrument id="voice">
        <longName>Vocals</longName>
        <instrumentId>voice.ensemble</instrumentId>
      </Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Clef>
            <concertClefType>G</concertClefType>
            <transposingClefType>G</transposingClefType>
          </Clef>
          <KeySig><concertKey>0</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Tempo><tempo>1.5</tempo></Tempo>
          <Harmony>
            <harmonyInfo>
              <name>m7</name>
              <root>14</root>
              <bass>16</bass>
            </harmonyInfo>
          </Harmony>
          <Chord>
            <durationType>quarter</durationType>
            <StemDirection>up</StemDirection>
            <Lyrics><syllabic>single</syllabic><text>la</text></Lyrics>
            <Note><pitch>60</pitch><tpc>14</tpc></Note>
            <Note><pitch>64</pitch><tpc>18</tpc></Note>
            <Note><pitch>67</pitch><tpc>15</tpc><tpc2>17</tpc2></Note>
          </Chord>
          <Chord>
            <durationType>quarter</durationType>
            <Note>
              <Accidental><role>1</role><subtype>accidentalFlat</subtype></Accidental>
              <pitch>68</pitch><tpc>10</tpc>
            </Note>
          </Chord>
          <Chord>
            <durationType>half</durationType>
            <Note>
              <Spanner type="Tie">
                <Tie></Tie>
                <next><location><measures>1</measures><fractions>-1/2</fractions></location></next>
              </Spanner>
              <pitch>60</pitch><tpc>14</tpc>
            </Note>
          </Chord>
        </voice>
      </Measure>
      <Measure>
        <LayoutBreak><subtype>line</subtype></LayoutBreak>
        <voice>
          <Chord>
            <durationType>whole</durationType>
            <Note>
              <Spanner type="Tie">
                <prev><location><measures>-1</measures><fractions>1/2</fractions></location></prev>
              </Spanner>
              <pitch>60</pitch><tpc>14</tpc>
            </Note>
          </Chord>
          <BarLine><subtype>end</subtype></BarLine>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

const SATB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.40">
  <programVersion>4.4.0</programVersion>
  <Score>
    <Division>480</Division>
    <Part id="1">
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Soprano</trackName>
      <Instrument id="voice"><longName>Soprano</longName><instrumentId>voice.soprano</instrumentId></Instrument>
    </Part>
    <Part id="2">
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Tenor</trackName>
      <Instrument id="voice"><longName>Tenor</longName><instrumentId>voice.tenor</instrumentId></Instrument>
    </Part>
    <Part id="3">
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Piano</trackName>
      <Instrument id="piano"><longName>Hidden Piano Name</longName><visible>0</visible><instrumentId>keyboard.piano</instrumentId></Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType></Clef>
          <KeySig><concertKey>2</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Harmony><harmonyInfo><root>16</root></harmonyInfo></Harmony>
          <Chord><durationType>quarter</durationType><Note><pitch>74</pitch><tpc>16</tpc></Note></Chord>
        </voice>
        <voice>
          <Chord><durationType>quarter</durationType><Note><pitch>69</pitch><tpc>17</tpc></Note></Chord>
        </voice>
      </Measure>
      <Measure>
        <LayoutBreak><subtype>line</subtype></LayoutBreak>
        <voice>
          <Chord><durationType>quarter</durationType><Note><pitch>72</pitch><tpc>14</tpc></Note></Chord>
        </voice>
      </Measure>
    </Staff>
    <Staff id="2">
      <Measure>
        <voice>
          <Clef><concertClefType>F</concertClefType></Clef>
          <KeySig><concertKey>2</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
        </voice>
        <voice>
          <Chord><durationType>quarter</durationType><Note><pitch>57</pitch><tpc>17</tpc></Note></Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Chord><durationType>quarter</durationType><Note><pitch>62</pitch><tpc>16</tpc></Note></Chord>
        </voice>
      </Measure>
    </Staff>
    <Staff id="3">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType></Clef>
          <Chord><durationType>quarter</durationType><Note><pitch>64</pitch><tpc>18</tpc></Note><Note><pitch>67</pitch><tpc>15</tpc></Note></Chord>
        </voice>
      </Measure>
      <Measure><voice><Rest><durationType>quarter</durationType></Rest></voice></Measure>
    </Staff>
    <Staff id="4">
      <Measure>
        <voice>
          <Clef><concertClefType>F</concertClefType></Clef>
          <Chord><durationType>quarter</durationType><Note><pitch>48</pitch><tpc>14</tpc></Note></Chord>
        </voice>
      </Measure>
      <Measure><voice><Rest><durationType>quarter</durationType></Rest></voice></Measure>
    </Staff>
  </Score>
</museScore>
`;

test("tpc spelling matches sounding pitch", () => {
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
  const c4 = pitchFromMidiTpc(60, 14);
  assert.deepEqual(c4, { step: "C", alter: 0, octave: 4 });
  assert.equal(tpcFromPitch(c4), 14);
  const fs5 = pitchFromMidiTpc(78, 20);
  assert.deepEqual(fs5, { step: "F", alter: 1, octave: 5 });
  assert.equal(pitchToMidi(fs5), 78);
  assert.equal(editedName("Song.MSCZ"), "Song (edited).mscz");
});

test("MuseScore 3 and older files are rejected", () => {
  const reject = (xml) => {
    assert.throws(() => openMscz(pack(xml)), /MuseScore 3 or older/);
  };
  reject(`<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="3.02"><Score></Score></museScore>\n`);
  reject(`<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="2.06"><Score></Score></museScore>\n`);
  reject(`<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="4.00"><programVersion>3.6.2</programVersion><Score></Score></museScore>\n`);
});

test("one-staff chords map top to bottom as S, A, and T", () => {
  const score = openMscz(pack(STACK_XML));
  assert.equal(score.format, "mscz");
  assert.equal(score.unresolvedTies, 0);
  assert.equal(score.quarterBpm, 90);
  assert.equal(score.parts.length, 1);
  assert.equal(score.parts[0].staffLabel, "Vocal");
  const chord = score.parts[0].measures[0].notes.filter((note) => note.pitch && note.startQl === 0);
  assert.deepEqual(
    chord.map((note) => note.parts[0]),
    ["T", "A", "S"],
  );
  assert.equal(chord.find((note) => note.parts[0] === "S").lyric.text, "la");
  assert.equal(chord.filter((note) => note.lyric).length, 1);
  assert.equal(score.parts[0].measures[0].harmonies[0].text, "Cm7/D");
  assert.equal(score.parts[0].measures[0].fifths, 0);
  const flat = score.parts[0].measures[0].notes.find((note) => note.pitch?.alter === -1);
  assert.equal(flat.parts[0], "S");
  assert.equal(flat.accidentalSpan != null, true);
  const tied = score.parts[0].measures[0].notes.find((note) => note.tieStart);
  const tail = score.parts[0].measures[1].notes.find((note) => note.tieStop);
  assert.equal(tied.tieGroup, tail.tieGroup);
  assert.equal(score.parts[0].measures[1].barlines.right, "final");
  const events = playbackEvents(score);
  assert.deepEqual(events.filter((event) => event.ql === 0).map((event) => event.channel).sort(), ["A", "S", "T"]);
  const held = events.find((event) => event.channel === "S" && event.ql === 2);
  assert.equal(held.durQl, 6);
  assert.equal(events.some((event) => event.channel === "S" && event.ql === 4), false);
  const view = renderScore(score, { activePart: "S", selectedId: null, showChanges: false, playMeasure: 0 });
  assert.match(view.music, /height="126"/);
  assert.match(view.gutter, />Vocal</);
  assert.doesNotMatch(view.gutter, />TB</);
  assert.ok(view.music.split("<ellipse").length > 3);
});

test("SA and TB staves sit above a piano that is not editable", () => {
  const score = openMscz(pack(SATB_XML));
  assert.deepEqual(
    score.parts.map((part) => part.role),
    ["SA", "TB", "piano"],
  );
  const sa = score.parts[0].measures[0];
  const tb = score.parts[1].measures[0];
  assert.deepEqual(sa.notes.find((note) => note.voice === "1").parts, ["S"]);
  assert.deepEqual(sa.notes.find((note) => note.voice === "2").parts, ["A"]);
  assert.deepEqual(tb.notes.find((note) => note.voice === "1").parts, ["T"]);
  assert.deepEqual(tb.notes.find((note) => note.voice === "2").parts, ["B"]);
  assert.equal(tb.clef.sign, "F");
  assert.equal(sa.harmonies[0].text, "D");
  assert.deepEqual(score.parts[1].measures[1].notes[0].parts, ["T", "B"]);
  assert.ok(score.parts[2].measures[0].notes.filter((note) => note.pitch).every((note) => note.parts.length === 0));
  assert.ok(playbackEvents(score).some((event) => event.channel === "P" && event.midi === 48));
  const view = renderScore(score, { activePart: "S", selectedId: null, showChanges: false, playMeasure: 0 });
  assert.match(view.gutter, />SA</);
  assert.match(view.gutter, />TB</);
  assert.match(view.music, /height="252"/);
});

test("an unedited export keeps every zip entry byte for byte", () => {
  const packed = pack(STACK_XML);
  const score = openMscz(packed);
  const out = exportMscz(score);
  const before = readZip(packed);
  const after = readZip(out);
  assert.deepEqual(
    before.map((entry) => entry.name),
    after.map((entry) => entry.name),
  );
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual(after[i].compressed, before[i].compressed, before[i].name);
    assert.deepEqual(entryData(after[i]), entryData(before[i]), before[i].name);
  }
});

test("edits change pitch data only, including a tie and an explicit accidental", () => {
  const packed = pack(STACK_XML);
  const originalXml = STACK_XML;
  const score = openMscz(packed);
  const chord = score.parts[0].measures[0].notes.filter((note) => note.pitch && note.startQl === 0);
  const top = chord.find((note) => note.parts[0] === "S");
  const flat = score.parts[0].measures[0].notes.find((note) => note.accidentalSpan);
  const tied = score.parts[0].measures[0].notes.find((note) => note.tieStart);
  setPitch(score, top.id, diatonicMove(top.pitch, 0, 1));
  setPitch(score, flat.id, chromaticMove(flat.pitch, 1));
  setPitch(score, tied.id, diatonicMove(tied.pitch, 0, 1));
  const editedIds = iterNotes(score).filter(isEdited).map((note) => note.id);
  assert.equal(editedIds.length, 4);
  assert.ok(editedIds.includes(score.parts[0].measures[1].notes.find((note) => note.tieStop).id));
  const beforeSpans = editedIds.flatMap((id) => changedSpans(iterNotes(score).find((note) => note.id === id)));
  const out = exportMscz(score);
  const afterEntries = readZip(out);
  const beforeEntries = readZip(packed);
  for (let i = 0; i < beforeEntries.length; i++) {
    if (/\.mscx$/i.test(beforeEntries[i].name)) continue;
    assert.deepEqual(afterEntries[i].compressed, beforeEntries[i].compressed, beforeEntries[i].name);
  }
  const mscx = afterEntries.find((entry) => /\.mscx$/i.test(entry.name));
  const afterXml = new TextDecoder().decode(inflateRawSync(mscx.compressed));
  assert.equal(new TextDecoder().decode(entryData(mscx)), afterXml);
  const after = openMscz(out);
  const afterSpans = editedIds.flatMap((id) => changedSpans(iterNotes(after).find((note) => note.id === id)));
  assert.equal(cutRanges(afterXml, afterSpans), cutRanges(originalXml, beforeSpans));
  assert.match(afterXml, /<LayoutBreak><subtype>line<\/subtype><\/LayoutBreak>/);
  assert.match(afterXml, /<text>la<\/text>/);
  assert.match(afterXml, /<name>m7<\/name>/);
  const editedTop = iterNotes(after).find((note) => note.id === top.id);
  assert.equal(pitchToMidi(editedTop.pitch), pitchToMidi(diatonicMove({ step: "G", alter: 0, octave: 4 }, 0, 1)));
  assert.match(afterXml, /<tpc2>19<\/tpc2>/);
  const editedFlat = iterNotes(after).find((note) => note.id === flat.id);
  assert.deepEqual(editedFlat.pitch, { step: "A", alter: 0, octave: 4 });
  assert.match(afterXml, /<subtype>accidentalNatural<\/subtype>/);
  assert.equal(afterXml.split("<tpc2>").length, originalXml.split("<tpc2>").length);
  setPitch(score, top.id, top.originalPitch);
  setPitch(score, flat.id, flat.originalPitch);
  setPitch(score, tied.id, tied.originalPitch);
  const restored = new TextDecoder().decode(entryData(readZip(exportMscz(score)).find((entry) => /\.mscx$/i.test(entry.name))));
  assert.equal(restored, originalXml);
});

test("a two-staff edit leaves the piano, the other voice, and the line break untouched", () => {
  const packed = pack(SATB_XML);
  const score = openMscz(packed);
  const soprano = score.parts[0].measures[0].notes.find((note) => note.parts[0] === "S");
  setPitch(score, soprano.id, diatonicMove(soprano.pitch, 2, 1));
  const out = exportMscz(score);
  const afterXml = new TextDecoder().decode(entryData(readZip(out).find((entry) => /\.mscx$/i.test(entry.name))));
  const after = openMscz(out);
  const ids = iterNotes(score).filter(isEdited).map((note) => note.id);
  assert.deepEqual(ids, [soprano.id]);
  assert.equal(
    cutRanges(afterXml, changedSpans(iterNotes(after).find((note) => note.id === soprano.id))),
    cutRanges(SATB_XML, changedSpans(soprano)),
  );
  assert.match(afterXml, /Hidden Piano Name/);
  assert.match(afterXml, /<visible>0<\/visible>/);
  assert.match(afterXml, /<subtype>line<\/subtype>/);
  const beforeEntries = readZip(packed);
  const afterEntries = readZip(out);
  for (let i = 0; i < beforeEntries.length; i++) {
    if (/\.mscx$/i.test(beforeEntries[i].name)) continue;
    assert.deepEqual(afterEntries[i].compressed, beforeEntries[i].compressed);
  }
});

test("a zip written by another library still opens", () => {
  const packed = zipSync({
    "sample.mscx": text(STACK_XML),
    "score_style.mss": text("<museScore version=\"4.20\"><Style><pageWidth>8.5</pageWidth></Style></museScore>"),
  });
  const score = openMscz(packed);
  assert.equal(score.parts[0].measures.length, 2);
  const out = exportMscz(score);
  assert.equal(new TextDecoder().decode(entryData(readZip(out).find((entry) => entry.name === "score_style.mss"))).includes("pageWidth"), true);
});

const CROSS_MSCZ = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20">
  <programVersion>4.2.1</programVersion>
  <Score>
    <Division>480</Division>
    <Part id="1">
      <Staff><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff>
      <trackName>Vocals</trackName>
      <Instrument id="voice"><longName>Vocals</longName><instrumentId>voice.ensemble</instrumentId></Instrument>
    </Part>
    <Staff id="1">
      <Measure>
        <voice>
          <Clef><concertClefType>G</concertClefType><transposingClefType>G</transposingClefType></Clef>
          <KeySig><concertKey>0</concertKey></KeySig>
          <TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
          <Chord><durationType>half</durationType><StemDirection>up</StemDirection><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
          <Chord><durationType>half</durationType><StemDirection>up</StemDirection><Note><pitch>64</pitch><tpc>18</tpc></Note></Chord>
        </voice>
        <voice>
          <Chord><durationType>half</durationType><StemDirection>down</StemDirection><Note><pitch>76</pitch><tpc>18</tpc></Note></Chord>
          <Chord><durationType>half</durationType><StemDirection>down</StemDirection><Note><pitch>60</pitch><tpc>14</tpc></Note></Chord>
        </voice>
      </Measure>
      <Measure>
        <voice>
          <Chord>
            <durationType>whole</durationType>
            <Note><pitch>60</pitch><tpc>14</tpc></Note>
            <Note><pitch>64</pitch><tpc>18</tpc></Note>
            <Note><pitch>67</pitch><tpc>15</tpc></Note>
          </Chord>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>
`;

const CROSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Vocals</part-name></score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><stem>up</stem></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><stem>up</stem></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><stem>down</stem></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><stem>down</stem></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
`;

function assertCrossing(score, label) {
  assert.equal(score.parts[0].staffLabel, "Vocal", label);
  const crossing = score.parts[0].measures[0];
  const melody = crossing.notes.filter((note) => note.pitch && note.parts[0] === "S");
  const high = crossing.notes.filter((note) => note.pitch && note.parts[0] === "A");
  assert.deepEqual(melody.map((note) => note.pitch.step + note.pitch.octave), ["C4", "E4"], label);
  assert.deepEqual(high.map((note) => note.pitch.step + note.pitch.octave), ["E5", "C4"], label);
  assert.ok(pitchToMidi(high[0].pitch) > pitchToMidi(melody[0].pitch), label);
  assert.ok(pitchToMidi(high[1].pitch) < pitchToMidi(melody[1].pitch), label);
  const chord = score.parts[0].measures[1].notes.filter((note) => note.pitch);
  assert.deepEqual(chord.map((note) => note.parts[0]), label === "musicxml" ? ["S", "A", "T"] : ["T", "A", "S"], label);
  const channels = playbackEvents(score).filter((event) => event.ql === 0).map((event) => event.channel);
  assert.ok(channels.includes("S") && channels.includes("A"), label);
  if (score.parts.some((part) => part.role === "piano")) assert.ok(channels.includes("P"), label);
  const view = renderScore(score, { activePart: "A", selectedId: high[0].id, showChanges: false, playMeasure: 0 });
  assert.match(view.music, /#d61f2c/);
  assert.match(view.music, /#e86a12/);
  return { melody, high, chord };
}

test("a single staff keeps voice identity when High crosses above Melody", () => {
  const mscz = openMscz(pack(CROSS_MSCZ));
  const xmlScore = parseScore(CROSS_XML);
  const fromMscz = assertCrossing(mscz, "mscz");
  const fromXml = assertCrossing(xmlScore, "musicxml");
  assert.equal(exportScore(xmlScore), CROSS_XML);

  const crossed = fromMscz.high[0];
  const below = { step: "B", alter: 0, octave: 3 };
  setPitch(mscz, crossed.id, below);
  assert.deepEqual(findPart(mscz, crossed.id), ["A"]);
  const exported = exportMscz(mscz);
  const reloaded = openMscz(exported);
  assert.deepEqual(findPart(reloaded, crossed.id), ["A"]);
  assert.deepEqual(findPitch(reloaded, crossed.id), below);
  assert.deepEqual(findPart(reloaded, fromMscz.melody[0].id), ["S"]);
  const bottom = fromMscz.chord.find((note) => note.parts[0] === "T");
  setPitch(reloaded, bottom.id, { step: "A", alter: 0, octave: 5 });
  const restacked = openMscz(exportMscz(reloaded));
  assert.deepEqual(findPart(restacked, bottom.id), ["T"]);
  assert.deepEqual(findPitch(restacked, bottom.id), { step: "A", alter: 0, octave: 5 });

  const xmlHigh = fromXml.high[0];
  setPitch(xmlScore, xmlHigh.id, below);
  assert.deepEqual(findPart(xmlScore, xmlHigh.id), ["A"]);
  const xmlOut = exportScore(xmlScore);
  const xmlAgain = parseScore(xmlOut);
  assert.deepEqual(findPart(xmlAgain, xmlHigh.id), ["A"]);
  assert.deepEqual(findPitch(xmlAgain, xmlHigh.id), below);
  setPitch(xmlScore, xmlHigh.id, xmlHigh.originalPitch);
  assert.equal(exportScore(xmlScore), CROSS_XML);
});

function findPart(score, id) {
  return iterNotes(score).find((note) => note.id === id).parts;
}

function findPitch(score, id) {
  return iterNotes(score).find((note) => note.id === id).pitch;
}

test("MusicXML still draws both vocal staves", () => {
  const xml = readFileSync(new URL("../fixtures/satb-sample.musicxml", import.meta.url), "utf8");
  const view = renderScore(parseScore(xml), { activePart: "S", selectedId: null, showChanges: false, playMeasure: 0 });
  assert.match(view.music, /height="252"/);
  assert.match(view.gutter, />SA</);
  assert.match(view.gutter, />TB</);
});

test("local MuseScore files round-trip when REAL_MSCZ is set", () => {
  const list = process.env.REAL_MSCZ;
  if (!list) return;
  for (const path of list.split(":")) {
    const bytes = new Uint8Array(readFileSync(path));
    const score = openMscz(bytes);
    assert.equal(exportMscz(score).length > 0, true);
    const again = readZip(exportMscz(openMscz(bytes)));
    const original = readZip(bytes);
    for (let i = 0; i < original.length; i++) {
      assert.equal(again[i].name, original[i].name, path);
      assert.deepEqual(again[i].compressed, original[i].compressed, original[i].name);
    }
    assert.equal(score.unresolvedTies, 0, path);
    const vocal = score.parts.find((part) => part.role === "SA" || part.role === "TB");
    assert.ok(vocal, path);
    const pitched = iterNotes(score).filter((note) => note.pitch && note.parts.length);
    assert.ok(pitched.length > 10, path);
    const tied = pitched.find((note) => note.tieGroup);
    const free = pitched.find((note) => !note.tieGroup && note.parts.includes("S"));
    assert.ok(free, path);
    const before = free.pitch;
    setPitch(score, free.id, diatonicMove(free.pitch, findMeasureFifths(score, free.id), 1));
    if (tied) setPitch(score, tied.id, chromaticMove(tied.pitch, 1));
    const edited = iterNotes(score).filter(isEdited);
    const out = exportMscz(score);
    const afterEntries = readZip(out);
    for (let i = 0; i < original.length; i++) {
      if (/\.mscx$/i.test(original[i].name)) continue;
      assert.deepEqual(afterEntries[i].compressed, original[i].compressed, original[i].name);
    }
    const afterXml = new TextDecoder().decode(entryData(afterEntries.find((entry) => /\.mscx$/i.test(entry.name))));
    const after = openMscz(out);
    const ids = edited.map((note) => note.id);
    assert.equal(
      cutRanges(afterXml, ids.flatMap((id) => changedSpans(iterNotes(after).find((note) => note.id === id)))),
      cutRanges(score.xml, ids.flatMap((id) => changedSpans(iterNotes(score).find((note) => note.id === id)))),
      path,
    );
    setPitch(score, free.id, before);
    if (tied) setPitch(score, tied.id, tied.originalPitch);
    const restored = readZip(exportMscz(score));
    for (let i = 0; i < original.length; i++) {
      assert.deepEqual(restored[i].compressed, original[i].compressed, original[i].name);
    }
    console.log(
      `REAL MSCZ measures ${vocal.measures.length} pitched ${pitched.length} edited ${ids.length} unresolved ${score.unresolvedTies}`,
    );
  }
});

function findMeasureFifths(score, id) {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      if (measure.notes.some((note) => note.id === id)) return measure.fifths;
    }
  }
  return 0;
}
