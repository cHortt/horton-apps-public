// Pitch spelling for edits. Up and Down move one step on the key's scale.
// Sharp and Flat move one semitone and keep the current letter when that
// spelling fits in a single or double accidental.

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ORDER = ["C", "D", "E", "F", "G", "A", "B"];
const SHARPS = ["F", "C", "G", "D", "A", "E", "B"];
const FLATS = ["B", "E", "A", "D", "G", "C", "F"];

export function keyAlters(fifths) {
  const alters = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const n = Math.max(-7, Math.min(7, fifths | 0));
  if (n > 0) for (let i = 0; i < n; i++) alters[SHARPS[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) alters[FLATS[i]] = -1;
  return alters;
}

export function pitchToMidi(pitch) {
  return (pitch.octave + 1) * 12 + SEMI[pitch.step] + (pitch.alter || 0);
}

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function samePitch(a, b) {
  if (!a || !b) return !a && !b;
  return a.step === b.step && (a.alter || 0) === (b.alter || 0) && a.octave === b.octave;
}

export function formatAlter(alter) {
  const n = Math.round(alter);
  return String(n);
}

// Bottom line is step 0. Treble: E4. Bass: G2.
export function staffStep(step, octave, clefSign) {
  const dia = octave * 7 + ORDER.indexOf(step);
  const bottom = clefSign === "F" ? 2 * 7 + 4 : 4 * 7 + 2;
  return dia - bottom;
}

export function diatonicMove(pitch, fifths, dir) {
  const alters = keyAlters(fifths);
  const midi = pitchToMidi(pitch);
  const cands = [];
  for (let oct = pitch.octave - 2; oct <= pitch.octave + 2; oct++) {
    for (const step of ORDER) {
      const next = { step, alter: alters[step], octave: oct };
      cands.push({ ...next, midi: pitchToMidi(next) });
    }
  }
  cands.sort((a, b) => a.midi - b.midi);
  const hit = dir > 0 ? cands.find((c) => c.midi > midi) : [...cands].reverse().find((c) => c.midi < midi);
  if (!hit) return { step: pitch.step, alter: pitch.alter || 0, octave: pitch.octave };
  return { step: hit.step, alter: hit.alter, octave: hit.octave };
}

export function chromaticMove(pitch, dir) {
  const target = pitchToMidi(pitch) + dir;
  const sameAlter = (pitch.alter || 0) + dir;
  const same = { step: pitch.step, alter: sameAlter, octave: pitch.octave };
  if (sameAlter >= -2 && sameAlter <= 2 && pitchToMidi(same) === target) return same;

  let step = pitch.step;
  let octave = pitch.octave;
  for (let guard = 0; guard < 8; guard++) {
    let i = ORDER.indexOf(step) + (dir > 0 ? 1 : -1);
    if (i > 6) {
      i = 0;
      octave += 1;
    } else if (i < 0) {
      i = 6;
      octave -= 1;
    }
    step = ORDER[i];
    const alter = target - ((octave + 1) * 12 + SEMI[step]);
    if (alter >= -2 && alter <= 2) return { step, alter, octave };
  }
  return { step: pitch.step, alter: pitch.alter || 0, octave: pitch.octave };
}

const ACCIDENTAL = { 2: "double-sharp", 1: "sharp", 0: "natural", [-1]: "flat", [-2]: "flat-flat" };

export function accidentalName(alter) {
  return ACCIDENTAL[alter] ?? null;
}

export function spell(pitch) {
  const mark = { 1: "#", 2: "x", [-1]: "b", [-2]: "bb" }[pitch.alter || 0] || "";
  return `${pitch.step}${mark}${pitch.octave}`;
}

export function spellPretty(pitch) {
  const mark = { 1: "♯", 2: "𝄪", [-1]: "♭", [-2]: "𝄫" }[pitch.alter || 0] || "";
  return `${pitch.step}${mark}${pitch.octave}`;
}

export function dbToGain(db) {
  return 10 ** (db / 20);
}

// Rehearsal-track mix: the active part is full level, other voices sit 10 dB
// under it, and the piano sits 11 dB under it.
export function defaultMix(active) {
  const voice = dbToGain(-10);
  const mix = { S: voice, A: voice, T: voice, B: voice, P: dbToGain(-11) };
  if (active in mix) mix[active] = 1;
  return mix;
}
