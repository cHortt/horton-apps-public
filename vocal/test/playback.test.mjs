import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "../js/fflate.mjs";
import { createMix } from "../js/mix.mjs";
import { openMscz } from "../js/mscz.mjs";
import { parseScore, playbackEvents, playbackTimeline, setPitch } from "../js/musicxml.mjs";
import { alignPianoEvents, blockChordMidis, preparePlayback } from "../js/playback.mjs";
import { renderVoiceTone } from "../js/voice.mjs";
import { dbToGain } from "../js/theory.mjs";
import { createEngine, startTransport } from "../js/audio.mjs";

function voiceScore(measures, name = "Voice") {
  return parseScore(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>${name}</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`);
}

function measure(number, inner, beats = 4) {
  return `<measure number="${number}">
    <attributes><divisions>1</divisions><time><beats>${beats}</beats><beat-type>4</beat-type></time></attributes>
    ${inner}
  </measure>`;
}

function note(step, octave, { cue = false, hidden = false, dur = 1, type = "quarter" } = {}) {
  const print = hidden ? ` print-object="no"` : "";
  const size = cue ? ` size="cue"` : "";
  const chord = cue ? "<chord/>" : "";
  return `<note${print}>${chord}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration><type${size}>${type}</type></note>`;
}

function harmony(step, kind, { bass = "", alter = "", bassAlter = "", degrees = "" } = {}) {
  const rootAlter = alter === "" ? "" : `<root-alter>${alter}</root-alter>`;
  const bassXml = bass
    ? `<bass><bass-step>${bass}</bass-step>${bassAlter === "" ? "" : `<bass-alter>${bassAlter}</bass-alter>`}</bass>`
    : "";
  return `<harmony><root><root-step>${step}</root-step>${rootAlter}</root><kind>${kind}</kind>${bassXml}${degrees}</harmony>`;
}

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

function fakeContext() {
  const created = [];
  const param = (value) => ({
    value,
    cancelScheduledValues() {},
    setValueAtTime(next) {
      this.value = next;
    },
    linearRampToValueAtTime(next) {
      this.value = next;
    },
    exponentialRampToValueAtTime(next) {
      this.value = next;
    },
  });
  const node = () => ({
    gain: param(1),
    connect() {},
    start() {},
    stop() {},
    threshold: param(0),
    knee: param(0),
    ratio: param(0),
    attack: param(0),
    release: param(0),
    frequency: param(440),
  });
  return {
    created,
    ctx: {
      currentTime: 0,
      sampleRate: 44100,
      destination: node(),
      state: "running",
      createGain() {
        const gain = node();
        created.push(gain);
        return gain;
      },
      createDynamicsCompressor: () => node(),
    },
  };
}

test("a slider change during playback updates the gain of that channel only", async () => {
  const { ctx, created } = fakeContext();
  const engine = createEngine(ctx);
  const mix = createMix(memoryStorage());
  let ended = 0;
  let stopped = 0;
  const stopAll = engine.stopAll;
  engine.stopAll = () => {
    stopped += 1;
    stopAll();
  };
  const transport = startTransport({
    engine,
    getEvents: () => [],
    fromQl: 0,
    endQl: 64,
    quarterBpm: 60,
    getMix: () => mix.playback(),
    onFrame() {},
    onEnd() {
      ended += 1;
    },
  });
  try {
    const buses = created.slice(1, 6);
    assert.equal(buses.length, 5);
    const gain = () => Object.fromEntries(["S", "A", "T", "B", "P"].map((channel, index) => [channel, buses[index].gain.value]));
    const before = gain();
    assert.equal(before.S, 1);
    assert.equal(before.A, 1);
    assert.ok(Math.abs(before.P - dbToGain(-6)) < 1e-12);
    mix.set("A", 6);
    const deadline = Date.now() + 1000;
    let after = gain();
    while (Math.abs(after.A - dbToGain(6)) > 1e-9 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      after = gain();
    }
    assert.ok(Math.abs(after.A - dbToGain(6)) < 1e-12);
    for (const channel of ["S", "T", "B", "P"]) assert.equal(after[channel], before[channel]);
    assert.equal(ended, 0);
    assert.equal(stopped, 0);
  } finally {
    transport.stop();
  }
});

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function fundamentalHz(samples, sampleRate) {
  const width = Math.min(samples.length, Math.floor(sampleRate * 0.32));
  const start = Math.min(Math.floor(sampleRate * 0.08), Math.max(0, samples.length - width));
  let mean = 0;
  for (let i = 0; i < width; i++) mean += samples[start + i];
  mean /= width;
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.floor(sampleRate / 70);
  const corr = new Float64Array(maxLag + 1);
  let energy = 0;
  for (let i = 0; i < width; i++) {
    const v = samples[start + i] - mean;
    energy += v * v;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < width - lag; i++) sum += (samples[start + i] - mean) * (samples[start + i + lag] - mean);
    corr[lag] = sum / energy;
  }
  let bestLag = minLag;
  let best = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > best) {
      best = corr[lag];
      bestLag = lag;
    }
  }
  // Prefer the shortest period that is nearly as strong, so a subharmonic
  // does not report the octave below.
  for (let lag = minLag + 1; lag < bestLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > best * 0.85) {
      bestLag = lag;
      break;
    }
  }
  const left = corr[bestLag - 1] || 0;
  const mid = corr[bestLag];
  const right = corr[bestLag + 1] || 0;
  const denom = left - 2 * mid + right;
  const shift = denom === 0 ? 0 : (0.5 * (left - right)) / denom;
  return sampleRate / (bestLag + shift);
}

test("synth melody notes from G3 through C5 play at the written pitch", () => {
  const bodies = [];
  for (let midi = 55; midi <= 72; midi++) {
    const name = NAMES[midi % 12];
    const step = name[0];
    const alter = name.length > 1 ? "<alter>1</alter>" : "";
    const octave = Math.floor(midi / 12) - 1;
    bodies.push(`<note><pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`);
  }
  const measures = [];
  for (let i = 0; i < bodies.length; i += 4) {
    measures.push(measure(String(measures.length + 1), bodies.slice(i, i + 4).join("")));
  }
  const score = voiceScore(measures.join(""));
  const melody = preparePlayback(score, null).events.filter((event) => event.channel === "S");
  assert.deepEqual(
    melody.map((event) => event.midi),
    Array.from({ length: 18 }, (_, i) => 55 + i),
  );
  let previous = 0;
  for (const event of melody) {
    const heard = fundamentalHz(renderVoiceTone(event.midi, 44100), 44100);
    const written = 440 * 2 ** ((event.midi - 69) / 12);
    const cents = 1200 * Math.log2(heard / written);
    const octaveUp = 1200 * Math.log2(heard / (written * 2));
    assert.ok(Math.abs(cents) < 50, `midi ${event.midi} heard ${heard.toFixed(1)} Hz, ${cents.toFixed(1)} cents`);
    assert.ok(Math.abs(octaveUp) > 600, `midi ${event.midi} sounded an octave high`);
    assert.ok(heard > previous, `midi ${event.midi} did not rise`);
    previous = heard;
  }
});

test("an invisible unison note plays with its part", () => {
  const score = voiceScore(
    measure(
      "1",
      `${note("G", 4)}${note("E", 4, { cue: true, hidden: true })}`,
    ),
  );
  const small = score.parts[0].measures[0].notes.find((item) => item.unison);
  assert.ok(small);
  assert.equal(small.visible, false);
  assert.deepEqual(small.parts, ["T"]);
  const events = playbackEvents(score).filter((event) => event.ql === 0);
  assert.ok(events.some((event) => event.channel === "S" && event.midi === 67));
  assert.ok(events.some((event) => event.channel === "T" && event.midi === 64));
});

test("playback follows a written repeat and still uses an edited pitch", () => {
  const score = voiceScore(
    `${measure("1", `<barline location="left"><repeat direction="forward"/></barline>${note("C", 4)}<barline location="right"><repeat direction="backward"/></barline>`)}${measure("2", note("D", 4))}`,
  );
  const timeline = playbackTimeline(score);
  assert.equal(timeline.endQl, 12);
  const before = playbackEvents(score).filter((event) => event.channel === "S").map((event) => event.ql);
  assert.deepEqual(before, [0, 4, 8]);
  const melody = score.parts[0].measures[0].notes.find((item) => item.pitch);
  setPitch(score, melody.id, { step: "E", alter: 0, octave: 4 });
  const edited = playbackEvents(score).filter((event) => event.channel === "S" && (event.ql === 0 || event.ql === 4));
  assert.equal(edited.length, 2);
  assert.ok(edited.every((event) => event.midi === 64));
});

test("chord symbols become block chords until a piano part is loaded", () => {
  const no3 = `<degree><degree-value>3</degree-value><degree-alter>0</degree-alter><degree-type>subtract</degree-type></degree>`;
  const score = voiceScore(
    measure(
      "1",
      `${harmony("G", "major", { degrees: no3 })}${note("G", 4)}${harmony("G", "major")}${note("G", 4)}${harmony("E", "minor")}${note("E", 4)}${harmony("D", "suspended-fourth")}${note("D", 4)}`,
    ),
  );
  const g = score.parts[0].measures[0].harmonies[1];
  assert.deepEqual(blockChordMidis(g), [55, 67, 71, 74]);
  assert.deepEqual(blockChordMidis(score.parts[0].measures[0].harmonies[0]), [55, 67, 74]);
  assert.deepEqual(blockChordMidis(score.parts[0].measures[0].harmonies[2]), [52, 64, 67, 71]);
  const slash = voiceScore(measure("1", `${harmony("G", "major", { bass: "B" })}${note("G", 4)}`));
  assert.deepEqual(blockChordMidis(slash.parts[0].measures[0].harmonies[0]), [59, 67, 71, 74]);
  const events = preparePlayback(score, null).events.filter((event) => event.channel === "P" && event.midi === 71);
  assert.equal(events[0].ql, 1);
  assert.equal(events[0].durQl, 1);
  assert.equal(events.some((event) => event.ql === 0), false);
  const withPiano = parseScore(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">${measure("1", `${harmony("G", "major")}${note("C", 4)}`)}</part>
  <part id="P2">${measure("1", note("F", 3))}</part>
</score-partwise>`);
  const played = preparePlayback(withPiano, null).events.filter((event) => event.channel === "P");
  assert.deepEqual(played.map((event) => event.midi), [53]);
});

test("a separate piano file lines up by measure number", () => {
  const vocal = voiceScore(`${measure("1", note("C", 4, { dur: 4, type: "whole" }))}${measure("2", note("D", 4, { dur: 4, type: "whole" }))}`);
  const pianoScore = parseScore(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${measure("9", note("D", 5))}
    ${measure("2", note("C", 4))}
  </part>
</score-partwise>`);
  const piano = pianoScore.parts.find((part) => part.role === "piano");
  const events = alignPianoEvents(vocal, piano);
  assert.deepEqual(events.map((event) => [event.ql, event.midi]), [[4, 60]]);
  const prepared = preparePlayback(vocal, piano).events.filter((event) => event.channel === "P");
  assert.deepEqual(prepared.map((event) => event.midi), [60]);
});

test("a MuseScore bass note tagged base is the slash bass", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.00"><Score>
  <Part id="1"><Staff id="1"><StaffType group="pitched"><name>stdNormal</name></StaffType></Staff><trackName>Vocals</trackName><Instrument id="voice"><instrumentId>voice.ensemble</instrumentId></Instrument></Part>
  <Staff id="1"><Measure><voice>
    <Harmony><root>15</root><base>19</base></Harmony>
    <Chord><durationType>quarter</durationType><Note><pitch>67</pitch><tpc>15</tpc></Note></Chord>
  </voice></Measure></Staff>
</Score></museScore>`;
  const score = openMscz(zipSync({ "score.mscx": new TextEncoder().encode(xml) }));
  const harmony = score.parts[0].measures[0].harmonies[0];
  assert.equal(harmony.text, "G/B");
  assert.deepEqual(blockChordMidis(harmony), [59, 67, 71, 74]);
});
