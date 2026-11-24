// Structural vocal edits. Pitch text, cue size, and added or removed notes are
// written back by the exporters. These functions only change the open score.

import { assignSizeParts, iterNotes, onsetKey } from "./musicxml.mjs";
import { chromaticMove, pitchToMidi } from "./theory.mjs";

export function cloneNote(note) {
  return {
    ...note,
    pitch: note.pitch ? { ...note.pitch } : null,
    originalPitch: note.originalPitch ? { ...note.originalPitch } : null,
    parts: [...(note.parts || [])],
    partCover: note.partCover ? [...note.partCover] : null,
    beams: (note.beams || []).map((beam) => ({ ...beam })),
  };
}

export function snapshotScore(score) {
  return {
    nextAdd: score.nextAdd || 1,
    parts: score.parts.map((part) =>
      part.measures.map((measure) => ({
        notes: measure.notes.map(cloneNote),
        dropped: (measure.dropped || []).map(cloneNote),
      })),
    ),
  };
}

export function restoreScore(score, snap) {
  score.nextAdd = snap.nextAdd;
  score.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      const saved = snap.parts[partIndex][measureIndex];
      measure.notes = saved.notes.map(cloneNote);
      measure.dropped = saved.dropped.map(cloneNote);
    });
  });
}

export function vocalPart(score) {
  return score?.parts.find((part) => part.role === "SA") || score?.parts.find((part) => part.role === "TB") || null;
}

export function chordMates(measure, note) {
  const key = onsetKey(note);
  return measure.notes.filter(
    (other) => other.pitch && !other.grace && other.voice === note.voice && onsetKey(other) === key,
  );
}

function findMeasure(score, note) {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      if (measure.notes.includes(note)) return measure;
    }
  }
  return null;
}

function everyNote(score) {
  const notes = [];
  for (const part of score.parts) {
    for (const measure of part.measures) notes.push(...measure.notes, ...(measure.dropped || []));
  }
  return notes;
}

function refreshMeasure(measure) {
  measure.notes.forEach((note, index) => {
    note.index = index;
  });
  const groups = new Map();
  for (const note of measure.notes) {
    if (!note.pitch || note.grace) continue;
    const key = `${note.voice}|${onsetKey(note)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }
  for (const group of groups.values()) {
    group.forEach((note, index) => {
      note.chordNote = index;
      note.chord = index > 0;
      note.chordSize = group.length;
    });
    if (group.length > 1) {
      const id = group.find((note) => note.chordId)?.chordId || group[0].id;
      for (const note of group) note.chordId = id;
    } else if (group[0]) group[0].chordId = "";
  }
}

function markDanglingTies(score) {
  const groups = new Map();
  for (const note of everyNote(score)) {
    note.stripTies = false;
    if (!note.tieGroup) continue;
    if (!groups.has(note.tieGroup)) groups.set(note.tieGroup, []);
    groups.get(note.tieGroup).push(note);
  }
  for (const group of groups.values()) {
    const live = group.filter((note) => !note.removed);
    if (group.length >= 2 && live.length === 1) live[0].stripTies = true;
  }
}

function dropNote(measure, note) {
  measure.notes = measure.notes.filter((item) => item !== note);
  if (note.added || !note.elementSpan) return;
  note.removed = true;
  if (!measure.dropped) measure.dropped = [];
  measure.dropped.push(note);
}

function makeAddedNote(score, melody, pitch, visible) {
  score.nextAdd = score.nextAdd || 1;
  return {
    id: `${melody.id}:add${score.nextAdd++}`,
    index: 0,
    voice: melody.voice,
    voiceIndex: melody.voiceIndex,
    isRest: false,
    measureRest: false,
    chord: true,
    chordSize: 2,
    originalChordNote: null,
    grace: false,
    startFrac: melody.startFrac,
    startQl: melody.startQl,
    durQl: melody.durQl,
    pitch: { ...pitch },
    originalPitch: { ...pitch },
    originalTpc: null,
    originalTpc2: null,
    type: melody.type || "quarter",
    dots: melody.dots || 0,
    stem: melody.stem || "",
    beamMode: "",
    beams: [],
    tieStart: false,
    tieStop: false,
    tieNext: null,
    tiePrev: null,
    lyric: null,
    parts: [],
    pitchSpan: null,
    tpcSpan: null,
    tpc2Span: null,
    accidentalSpan: null,
    pitchRange: null,
    accidentalRange: null,
    accidental: null,
    staffIndex: melody.staffIndex,
    measureIndex: melody.measureIndex,
    chordNote: 99,
    midi: pitchToMidi(pitch),
    small: true,
    originalSmall: true,
    visible: visible !== false,
    originalVisible: true,
    unison: visible === false,
    added: true,
    removed: false,
    stripTies: false,
    ambiguous: false,
    stackLower: false,
    partCover: null,
    elementSpan: null,
    noteOpenSpan: null,
    typeTagSpan: null,
    chordTagSpan: null,
    smallSpan: null,
    visibleSpan: null,
    spannerSpans: [],
    tieSpans: [],
    tagInsertAt: null,
    childIndent: melody.childIndent || "",
    noteIndent: melody.noteIndent || "",
    insertAt: melody.insertAt,
    chordKey: melody.chordKey,
    chordSpan: melody.chordSpan,
    lyricXml: null,
    beamXml: null,
    durationText: melody.durationText || "",
    chordId: melody.chordId || melody.id,
  };
}

function insertAfter(measure, chord, note) {
  const last = chord.reduce((best, item) => (measure.notes.indexOf(item) >= measure.notes.indexOf(best) ? item : best), chord[0]);
  const at = Math.max(0, measure.notes.indexOf(last));
  measure.notes.splice(at + 1, 0, note);
  chord.push(note);
}

function melodyOf(chord) {
  return (
    chord.find((note) => !note.small && note.parts?.includes("A")) ||
    chord.find((note) => !note.small) ||
    chord.find((note) => note.parts?.includes("A")) ||
    null
  );
}

function harmonyPitch(melody, part, others, bothFresh) {
  const base = { step: melody.pitch.step, alter: melody.pitch.alter || 0, octave: melody.pitch.octave };
  if (part !== "S" || bothFresh) return base;
  const midis = others.filter((note) => note.small).map((note) => pitchToMidi(note.pitch));
  if (!midis.length) return chromaticMove(base, 1);
  if (pitchToMidi(base) > Math.max(...midis)) return base;
  let pitch = { ...base };
  let guard = 0;
  while (pitchToMidi(pitch) <= Math.max(...midis) && guard < 16) {
    pitch = chromaticMove(pitch, 1);
    guard += 1;
  }
  return pitch;
}

function finish(score, measures) {
  for (const measure of measures) refreshMeasure(measure);
  const part = vocalPart(score);
  if (part?.convention === "size" && measures.size) assignSizeParts([...measures]);
}

export function addParts(score, chords, parts) {
  const measures = new Set();
  for (const chord of chords) {
    if (!chord.length) continue;
    const measure = findMeasure(score, chord[0]);
    const melody = melodyOf(chord);
    if (!measure || !melody?.pitch) continue;
    const wanted = parts.filter((part) => part !== "A" && !chord.some((note) => note.parts.includes(part)));
    if (!wanted.length) continue;
    const bothFresh = wanted.includes("S") && wanted.includes("T") && !chord.some((note) => note.small);
    const created = [];
    for (const part of wanted) {
      const pitch = harmonyPitch(melody, part, [...chord.filter((note) => note.small), ...created], bothFresh);
      const note = makeAddedNote(score, melody, pitch, true);
      created.push(note);
      insertAfter(measure, chord, note);
    }
    measures.add(measure);
  }
  finish(score, measures);
  return measures.size;
}

export function removePart(score, chords, part) {
  if (!part || part === "A") return 0;
  const measures = new Set();
  for (const chord of chords) {
    if (!chord.length) continue;
    const measure = findMeasure(score, chord[0]);
    if (!measure) continue;
    for (const note of [...chord]) {
      if (note.small && note.parts.includes(part)) {
        dropNote(measure, note);
        measures.add(measure);
      }
    }
  }
  markDanglingTies(score);
  finish(score, measures);
  return measures.size;
}

export function setMelodyNotes(score, chords, part) {
  const measures = new Set();
  for (const chord of chords) {
    const chosen = chord.find((note) => note.parts.includes(part) && note.small);
    if (!chosen) continue;
    const measure = findMeasure(score, chosen);
    for (const note of chord) {
      if (note === chosen) {
        note.small = false;
        note.visible = true;
      } else if (!note.small) {
        note.small = true;
        note.visible = true;
      }
    }
    if (measure) measures.add(measure);
  }
  finish(score, measures);
  return measures.size;
}

export function setUnisonNotes(score, chords, part) {
  const names = part === "A" ? ["S", "T"] : [part];
  const plan = [];
  for (const chord of chords) {
    if (!chord.length) continue;
    const measure = findMeasure(score, chord[0]);
    const melody = melodyOf(chord);
    if (!measure || !melody?.pitch) continue;
    for (const name of names) {
      if (!name || name === "A") continue;
      plan.push({
        chord,
        measure,
        melody,
        targets: chord.filter((note) => note !== melody && note.parts.includes(name)),
      });
    }
  }
  const existing = plan.flatMap((item) => item.targets);
  const turnOn = plan.some((item) => item.targets.length === 0) || existing.some((note) => !note.unison);
  const measures = new Set();
  for (const item of plan) {
    if (!item.targets.length) {
      if (!turnOn) continue;
      const note = makeAddedNote(score, item.melody, { ...item.melody.pitch }, false);
      insertAfter(item.measure, item.chord, note);
      measures.add(item.measure);
      continue;
    }
    for (const note of item.targets) {
      const mates =
        score.tieTogether && note.tieGroup
          ? iterNotes(score).filter((itemNote) => itemNote.tieGroup === note.tieGroup && itemNote.pitch && !itemNote.removed)
          : [note];
      for (const mate of mates) {
        if (turnOn) {
          mate.pitch = { ...item.melody.pitch };
          mate.small = true;
          mate.visible = false;
        } else {
          mate.visible = true;
          mate.small = true;
        }
        const mateMeasure = findMeasure(score, mate);
        if (mateMeasure) measures.add(mateMeasure);
      }
    }
  }
  finish(score, measures);
  return measures.size;
}

export function setStackCover(chords, cover) {
  let count = 0;
  for (const chord of chords) {
    const lower = chord.find((note) => note.stackLower);
    if (!lower) continue;
    lower.partCover = [...cover];
    lower.parts = [...cover];
    count += 1;
  }
  return count;
}
