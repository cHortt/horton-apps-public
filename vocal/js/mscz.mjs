// MuseScore 3 and 4 .mscz import and export.
// A .mscz file is a zip. The score itself is one .mscx XML entry; everything
// else (style, breaks stored in that XML, thumbnail, mixer settings) is left
// alone. Export splices pitch, tpc, tpc2, and an explicit accidental on the
// notes that actually changed, and copies every other zip entry through.
// Adding or removing a harmony note, or changing which note is full size,
// touches only those chords.

import {
  applyReplacements,
  assignSingleStaffParts,
  assignSizeParts,
  child,
  closingInsertAt,
  elementRemovalSpan,
  indentAt,
  isEdited,
  NO_STAFF_ERROR,
  parseDocument,
  textOf,
  usesSizeNotes,
} from "./musicxml.mjs";
import { pitchToMidi } from "./theory.mjs";
import { entryData, readZip, writeZip } from "./zip.mjs";

const FIFTHS = ["F", "C", "G", "D", "A", "E", "B"];
const NATURAL_TPC = { C: 14, D: 16, E: 18, F: 13, G: 15, A: 17, B: 19 };
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const TYPE_FRAC = {
  maxima: [8, 1],
  long: [4, 1],
  breve: [2, 1],
  whole: [1, 1],
  half: [1, 2],
  quarter: [1, 4],
  eighth: [1, 8],
  "16th": [1, 16],
  "32nd": [1, 32],
  "64th": [1, 64],
  "128th": [1, 128],
};
const BEAM_LEVEL = { eighth: 1, "16th": 2, "32nd": 3, "64th": 4 };
const SUBTYPE = {
  [-2]: "accidentalDoubleFlat",
  [-1]: "accidentalFlat",
  0: "accidentalNatural",
  1: "accidentalSharp",
  2: "accidentalDoubleSharp",
};

const OLDER_FILE = "This file is MuseScore 2 or older. This editor opens MuseScore 3 and 4 files.";

export function tpcInfo(tpc) {
  const n = Number(tpc);
  const step = FIFTHS[((n + 1) % 7 + 7) % 7];
  const alter = Math.floor((n + 1) / 7) - 2;
  return { step, alter };
}

export function tpcFromPitch(pitch) {
  return NATURAL_TPC[pitch.step] + (pitch.alter || 0) * 7;
}

export function pitchFromMidiTpc(midi, tpc) {
  const { step, alter } = tpcInfo(tpc);
  const octave = (midi - SEMI[step] - alter) / 12 - 1;
  return { step, alter, octave };
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function reduce(n, d) {
  if (!d) return [0, 1];
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return [n / g, d / g];
}

function addFrac(a, b) {
  return reduce(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
}

function parseFrac(text) {
  if (!text) return [0, 1];
  const [n, d] = String(text).split("/").map((part) => Number(part));
  if (!Number.isFinite(n)) return [0, 1];
  return reduce(n, d || 1);
}

function fracQl(frac) {
  return (frac[0] / frac[1]) * 4;
}

function versionError(xml) {
  const tag = xml.match(/<museScore\b[^>]*>/);
  if (!tag) return "This file is not a MuseScore score.";
  const version = tag[0].match(/\bversion\s*=\s*(?:"([^"]+)"|'([^']+)')/);
  const raw = version?.[1] || version?.[2] || "";
  const major = Number(raw.split(".")[0]);
  if (!raw || !Number.isFinite(major)) return "This file is not a MuseScore score.";
  if (major < 3) return OLDER_FILE;
  return "";
}

function numberSpan(xml, el) {
  if (!el || el.innerEnd == null) return null;
  const inner = xml.slice(el.openEnd, el.innerEnd);
  const match = inner.match(/-?\d+/);
  if (!match) return null;
  return { start: el.openEnd + match.index, end: el.openEnd + match.index + match[0].length };
}

function subtypeSpan(xml, noteEl) {
  const accidental = noteEl.children.find((el) => el.tag === "Accidental");
  const subtype = accidental?.children.find((el) => el.tag === "subtype");
  if (!subtype || subtype.innerEnd == null) return null;
  const inner = xml.slice(subtype.openEnd, subtype.innerEnd);
  const match = inner.match(/[A-Za-z0-9_:-]+/);
  if (!match) return null;
  return { start: subtype.openEnd + match.index, end: subtype.openEnd + match.index + match[0].length };
}

function plainText(xml, el) {
  return textOf(xml, el).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function accidentalMark(alter) {
  if (alter === 1) return "#";
  if (alter === -1) return "b";
  if (alter === 2) return "x";
  if (alter === -2) return "bb";
  return "";
}

function readMuseHarmony(xml, el) {
  const info = child(el, "harmonyInfo");
  const rootText = textOf(xml, child(info, "root")) || textOf(xml, child(el, "root"));
  if (rootText === "" || !Number.isFinite(Number(rootText))) return null;
  const name = textOf(xml, child(info, "name")) || textOf(xml, child(el, "name"));
  const bassText =
    textOf(xml, child(info, "bass")) ||
    textOf(xml, child(el, "bass")) ||
    textOf(xml, child(info, "base")) ||
    textOf(xml, child(el, "base"));
  const root = tpcInfo(Number(rootText));
  let text = `${root.step}${accidentalMark(root.alter)}`;
  if (name) text += name;
  let bass = null;
  if (bassText !== "" && Number.isFinite(Number(bassText))) {
    const parsed = tpcInfo(Number(bassText));
    bass = { step: parsed.step, alter: parsed.alter };
    text += `/${bass.step}${accidentalMark(bass.alter)}`;
  }
  return { text, root: { step: root.step, alter: root.alter }, kind: name || "", bass, degrees: [] };
}

function clefSign(type) {
  return String(type || "G").startsWith("F") ? "F" : "G";
}

const VOCAL_NAME = /vocal|melody|harmony|soprano|alto|tenor|bass|choir|voice|sing|lead/;
const PIANO_NAME = /piano|keyboard|keys|organ/;

function nameBlob(meta) {
  return `${meta.trackName} ${meta.longName} ${meta.shortName} ${meta.instrumentId}`.toLowerCase();
}

function isClearlyVocal(meta) {
  // A voice.* instrument still counts when longName, shortName, and trackName are blank.
  return VOCAL_NAME.test(nameBlob(meta));
}

function kindOf(meta) {
  if (isClearlyVocal(meta)) return "vocal";
  if (PIANO_NAME.test(nameBlob(meta))) return "piano";
  if (meta.staffCount >= 2) return "piano";
  return "vocal";
}

function staffHasLyrics(staff) {
  return staff.measures.some((measure) => measure.notes.some((note) => note.lyric));
}

function staffHasNotes(staff) {
  return staff.measures.some((measure) => measure.notes.some((note) => note.pitch && !note.grace));
}

function choiceLabel(staff) {
  const name = [staff.meta.trackName, staff.meta.longName, staff.meta.shortName]
    .map((part) => String(part || "").trim())
    .find(Boolean);
  const sign = staff.measures[0]?.clef?.sign === "F" ? "bass clef" : "treble clef";
  const where = `Staff ${staff.staffIndex + 1}`;
  return name ? `${where}, ${name}, ${sign}` : `${where}, ${sign}`;
}

// Names decide first. With no named voice, lyrics mark the staff to edit, and
// so does a score that has only one staff. Several remaining staves are a
// choice. Rest-only staves are not choices. Nothing here is written back.
function selectUnlabeled(staves, vocalStaffIndex) {
  const lyric = staves.filter(staffHasLyrics);
  if (lyric.length) {
    const chosen = new Set(lyric);
    return { vocal: lyric, piano: staves.filter((staff) => !chosen.has(staff)) };
  }
  if (staves.length === 1) {
    if (!staffHasNotes(staves[0])) throw new Error(NO_STAFF_ERROR);
    return { vocal: staves, piano: [] };
  }
  const usable = staves.filter(staffHasNotes);
  if (vocalStaffIndex == null) {
    if (!usable.length) throw new Error(NO_STAFF_ERROR);
    if (usable.length === 1) {
      const only = usable[0];
      return { vocal: [only], piano: staves.filter((staff) => staff !== only) };
    }
    return {
      needsStaffChoice: true,
      choices: usable.map((staff) => ({ index: staff.staffIndex, label: choiceLabel(staff) })),
    };
  }
  const staff = staves.find((item) => item.staffIndex === vocalStaffIndex);
  if (!staff || !staffHasNotes(staff)) throw new Error(NO_STAFF_ERROR);
  return { vocal: [staff], piano: staves.filter((item) => item !== staff) };
}

function durationOf(xml, el, measureFrac) {
  const written = textOf(xml, child(el, "duration"));
  if (written.includes("/")) return parseFrac(written);
  const type = textOf(xml, child(el, "durationType")) || "quarter";
  if (type === "measure") return measureFrac;
  const base = TYPE_FRAC[type] || [1, 4];
  let dots = 0;
  for (const dot of el.children.filter((childEl) => childEl.tag === "dots")) {
    const n = textOf(xml, dot);
    dots += n ? Number(n) : 1;
  }
  if (!dots) return base;
  return reduce(base[0] * ((1 << (dots + 1)) - 1), base[1] * (1 << dots));
}

function dotCount(xml, el) {
  let dots = 0;
  for (const dot of el.children.filter((childEl) => childEl.tag === "dots")) {
    const n = textOf(xml, dot);
    dots += n ? Number(n) : 1;
  }
  return dots;
}

function barKind(subtype) {
  if (subtype === "end") return "final";
  if (subtype === "double") return "double";
  if (subtype === "start-repeat" || subtype === "repeat-start") return "repeat-forward";
  if (subtype === "end-repeat" || subtype === "repeat-end") return "repeat-backward";
  return "regular";
}

function readLocation(xml, el) {
  if (!el) return null;
  const loc = child(el, "location");
  if (!loc) return null;
  return {
    measures: Number(textOf(xml, child(loc, "measures")) || 0),
    fractions: parseFrac(textOf(xml, child(loc, "fractions"))),
    notes: Number(textOf(xml, child(loc, "notes")) || 0),
    voices: Number(textOf(xml, child(loc, "voices")) || 0),
    staves: Number(textOf(xml, child(loc, "staves")) || 0),
  };
}

function beamsFor(notes) {
  const levelOf = (note) => (note.grace || note.isRest || note.beamMode === "no" ? 0 : BEAM_LEVEL[note.type] || 0);
  let index = 0;
  while (index < notes.length) {
    if (!levelOf(notes[index])) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < notes.length && levelOf(notes[end]) && notes[end].beamMode !== "begin") end += 1;
    const group = notes.slice(index, end);
    if (group.length >= 2) {
      for (let level = 1; level <= 3; level++) {
        for (let i = 0; i < group.length; i++) {
          const note = group[i];
          if (levelOf(note) < level) continue;
          const prev = i > 0 && levelOf(group[i - 1]) >= level && group[i].beamMode !== "begin";
          const next = i + 1 < group.length && levelOf(group[i + 1]) >= level && group[i + 1].beamMode !== "begin";
          const startsHere =
            !prev ||
            (level === 2 && note.beamMode === "begin16") ||
            (level === 3 && (note.beamMode === "begin32" || note.beamMode === "begin16"));
          let type = "continue";
          if (startsHere && next) type = "begin";
          else if (startsHere && !next) type = "forward hook";
          else if (!next) type = "end";
          if (type === "forward hook" && level === 1) continue;
          note.beams.push({ number: level, type });
        }
      }
    }
    index = end;
  }
}

function parseStaff(xml, staffEl, meta, staffIndex) {
  let fifths = 0;
  let beats = 4;
  let beatType = 4;
  let clef = { sign: "G", line: 2 };
  let quarterBpm = null;
  const measures = [];
  const measureEls = staffEl.children.filter((el) => el.tag === "Measure");
  measureEls.forEach((measureEl, measureIndex) => {
    const notes = [];
    const harmonies = [];
    const barlines = { left: null, right: null };
    let pendingStem = "";
    const consume = (el, voiceIndex, cursorRef, seenRef) => {
      if (el.tag === "KeySig") {
        const keyText = textOf(xml, child(el, "concertKey")) || textOf(xml, child(el, "actualKey")) || textOf(xml, child(el, "accidental"));
        if (keyText !== "") fifths = Number(keyText);
      } else if (el.tag === "TimeSig") {
        const n = textOf(xml, child(el, "sigN"));
        const d = textOf(xml, child(el, "sigD"));
        if (n) beats = Number(n);
        if (d) beatType = Number(d);
      } else if (el.tag === "Clef") {
        const type = textOf(xml, child(el, "concertClefType")) || textOf(xml, child(el, "transposingClefType"));
        if (type) {
          const sign = clefSign(type);
          clef = { sign, line: sign === "F" ? 4 : 2 };
        }
      } else if (el.tag === "Tempo") {
        const tempo = Number(textOf(xml, child(el, "tempo")));
        if (Number.isFinite(tempo) && quarterBpm == null) quarterBpm = tempo * 60;
      } else if (el.tag === "Harmony") {
        const harmony = readMuseHarmony(xml, el);
        if (harmony) harmonies.push({ ql: fracQl(cursorRef.frac), ...harmony });
      } else if (el.tag === "BarLine") {
        const kind = barKind(textOf(xml, child(el, "subtype")));
        if (!seenRef.seen && !barlines.left) barlines.left = kind;
        else barlines.right = kind;
      } else if (el.tag === "startRepeat") barlines.left = "repeat-forward";
      else if (el.tag === "endRepeat") barlines.right = "repeat-backward";
      else if (el.tag === "Beam" || el.tag === "Tuplet") {
        const stem = textOf(xml, child(el, "StemDirection"));
        if (stem) pendingStem = stem;
        for (const inner of el.children) consume(inner, voiceIndex, cursorRef, seenRef);
      } else if (el.tag === "Chord" || el.tag === "Rest") {
        readEvent(el, voiceIndex, cursorRef, seenRef);
      }
    };
    const readEvent = (el, voiceIndex, cursorRef, seenRef) => {
      const grace = el.children.some((childEl) => childEl.tag === "grace" || childEl.tag.startsWith("grace"));
      const dur = durationOf(xml, el, reduce(beats, beatType));
      const type = textOf(xml, child(el, "durationType")) || "quarter";
      const stem = textOf(xml, child(el, "StemDirection")) || pendingStem;
      const beamMode = textOf(xml, child(el, "BeamMode"));
      const lyricEl = child(el, "Lyrics");
      const lyric = lyricEl
        ? { text: plainText(xml, child(lyricEl, "text")), syllabic: textOf(xml, child(lyricEl, "syllabic")) }
        : null;
      const noteEls = el.tag === "Rest" ? [null] : el.children.filter((childEl) => childEl.tag === "Note");
      const start = cursorRef.frac;
      const made = [];
      const firstNoteEl = noteEls.find(Boolean);
      const chordInsertAt = el.tag === "Chord" ? closingInsertAt(xml, el.innerEnd) : null;
      const noteIndent = firstNoteEl ? indentAt(xml, firstNoteEl.start) : indentAt(xml, el.innerEnd || el.start);
      const firstPitch = firstNoteEl ? child(firstNoteEl, "pitch") : null;
      const childIndent = firstPitch ? indentAt(xml, firstPitch.start) : `${noteIndent}  `;
      const chordSpan = el.tag === "Chord" ? { start: el.start, end: el.end } : null;
      const chordKey = `${staffIndex}|${measureIndex}|${voiceIndex}|${start[0]}/${start[1]}`;
      noteEls.forEach((noteEl, chordNote) => {
        const pitchEl = noteEl ? child(noteEl, "pitch") : null;
        const tpcEl = noteEl ? child(noteEl, "tpc") : null;
        const tpc2El = noteEl ? child(noteEl, "tpc2") : null;
        const midi = pitchEl ? Number(textOf(xml, pitchEl)) : null;
        const tpc = tpcEl ? Number(textOf(xml, tpcEl)) : null;
        const tpc2 = tpc2El ? Number(textOf(xml, tpc2El)) : null;
        const pitch = midi == null || tpc == null || !Number.isFinite(midi) || !Number.isFinite(tpc) ? null : pitchFromMidiTpc(midi, tpc);
        let tieNext = null;
        let tiePrev = null;
        const spannerSpans = [];
        if (noteEl) {
          for (const childEl of noteEl.children) {
            const tie = (childEl.tag === "Spanner" && childEl.attrs.type === "Tie") || childEl.tag === "Tie";
            if (!tie) continue;
            if (childEl.tag === "Spanner") {
              const span = elementRemovalSpan(xml, childEl);
              if (span) spannerSpans.push(span);
            }
            tieNext = tieNext || readLocation(xml, child(childEl, "next"));
            tiePrev = tiePrev || readLocation(xml, child(childEl, "prev"));
          }
        }
        const smallEl = noteEl ? child(noteEl, "small") : null;
        const visibleEl = noteEl ? child(noteEl, "visible") : null;
        const small = !!(smallEl && textOf(xml, smallEl) !== "0");
        const visible = !(visibleEl && textOf(xml, visibleEl) === "0");
        const note = {
          voice: String(voiceIndex + 1),
          voiceIndex,
          isRest: el.tag === "Rest" || !pitch,
          measureRest: type === "measure",
          chord: chordNote > 0,
          chordSize: Math.max(1, noteEls.length),
          originalChordNote: chordNote,
          grace,
          startFrac: start,
          startQl: fracQl(start),
          durQl: fracQl(dur),
          pitch,
          originalPitch: pitch ? { ...pitch } : null,
          originalTpc: tpc,
          originalTpc2: tpc2,
          type: type === "measure" ? "whole" : type,
          dots: dotCount(xml, el),
          stem: stem === "up" || stem === "down" ? stem : "",
          beamMode,
          beams: [],
          tieStart: !!tieNext,
          tieStop: !!tiePrev,
          tieNext,
          tiePrev,
          lyric: null,
          parts: [],
          pitchSpan: numberSpan(xml, pitchEl),
          tpcSpan: numberSpan(xml, tpcEl),
          tpc2Span: numberSpan(xml, tpc2El),
          accidentalSpan: noteEl ? subtypeSpan(xml, noteEl) : null,
          staffIndex,
          measureIndex,
          chordNote,
          midi,
          small: small && !grace,
          originalSmall: small && !grace,
          visible,
          originalVisible: visible,
          unison: false,
          added: false,
          removed: false,
          stripTies: false,
          ambiguous: false,
          stackLower: false,
          partCover: null,
          elementSpan: noteEl ? elementRemovalSpan(xml, noteEl) : null,
          smallSpan: smallEl ? elementRemovalSpan(xml, smallEl) : null,
          visibleSpan: visibleEl ? elementRemovalSpan(xml, visibleEl) : null,
          spannerSpans,
          tieSpans: [],
          tagInsertAt: noteEl ? closingInsertAt(xml, noteEl.innerEnd) : null,
          childIndent,
          noteIndent,
          insertAt: chordInsertAt,
          chordKey,
          chordSpan,
          lyricXml: null,
          beamXml: null,
          chordTagSpan: null,
          durationText: null,
        };
        notes.push(note);
        made.push(note);
      });
      if (lyric && made.length) {
        const full = made.filter((note) => note.pitch && !note.small);
        const pool = full.length ? full : made;
        const host = pool.reduce((best, note) => ((note.midi ?? -1) >= (best.midi ?? -1) ? note : best));
        host.lyric = lyric;
      }
      if (!grace) cursorRef.frac = addFrac(cursorRef.frac, dur);
      seenRef.seen = true;
    };
    let voiceIndex = 0;
    for (const el of measureEl.children) {
      if (el.tag === "startRepeat") barlines.left = "repeat-forward";
      else if (el.tag === "endRepeat") barlines.right = "repeat-backward";
      else if (el.tag === "voice") {
        const cursorRef = { frac: [0, 1] };
        const seenRef = { seen: false };
        for (const inner of el.children) consume(inner, voiceIndex, cursorRef, seenRef);
        voiceIndex += 1;
      }
    }
    const voiced = new Map();
    for (const note of notes) {
      const key = note.voiceIndex;
      if (!voiced.has(key)) voiced.set(key, []);
      voiced.get(key).push(note);
    }
    for (const group of voiced.values()) beamsFor(group.filter((note) => !note.grace));
    measures.push({
      index: measureIndex,
      number: String(measureIndex + 1),
      fifths,
      beats,
      beatType,
      clef: { ...clef },
      divisions: 480,
      harmonies,
      barlines,
      notes,
    });
  });
  return { kind: kindOf(meta), meta, measures, quarterBpm, staffIndex };
}

function posKey(staff, measure, frac, voice, note) {
  return `${staff}|${measure}|${frac[0]}/${frac[1]}|${voice}|${note}`;
}

function linkTies(staves) {
  const byPos = new Map();
  const notes = [];
  for (const staff of staves) {
    for (const measure of staff.measures) {
      for (const note of measure.notes) {
        if (!note.pitch) continue;
        notes.push(note);
        byPos.set(posKey(note.staffIndex, note.measureIndex, note.startFrac, note.voiceIndex, note.chordNote), note);
      }
    }
  }
  const parent = new Map();
  const find = (id) => {
    let next = parent.get(id) || id;
    if (next !== id) {
      next = find(next);
      parent.set(id, next);
    }
    return next;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  let unresolved = 0;
  for (const note of notes) {
    for (const loc of [note.tieNext, note.tiePrev]) {
      if (!loc) continue;
      const frac = addFrac(note.startFrac, loc.fractions);
      const other = byPos.get(
        posKey(note.staffIndex + loc.staves, note.measureIndex + loc.measures, frac, note.voiceIndex + loc.voices, note.chordNote + loc.notes),
      );
      if (!other) {
        unresolved += 1;
        continue;
      }
      union(note, other);
    }
  }
  const grouped = new Map();
  for (const note of notes) {
    if (!note.tieNext && !note.tiePrev) continue;
    const root = find(note);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(note);
  }
  let tieSerial = 0;
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const id = `tie:${tieSerial++}`;
    for (const note of group) note.tieGroup = id;
  }
  return unresolved;
}

function assignVoices(measures, pair, unison) {
  for (const measure of measures) {
    const hasSecond = measure.notes.some((note) => note.voice === "2" && note.pitch);
    for (const note of measure.notes) {
      if (!note.pitch) {
        note.parts = [];
        continue;
      }
      if (unison && !hasSecond) note.parts = [...pair];
      else if (pair.length === 4) note.parts = [pair[Math.min(note.voiceIndex, pair.length - 1)]];
      else note.parts = [note.voice === "2" ? pair[1] : pair[0]];
    }
  }
}

function assignOneStaff(measures) {
  if (usesSizeNotes(measures)) {
    assignSizeParts(measures);
    return "size";
  }
  assignSingleStaffParts(measures, { topFirst: false });
  return "legacy";
}

function finishNotes(part) {
  for (const measure of part.measures) {
    measure.notes.forEach((note, index) => {
      note.index = index;
      note.id = `${part.role}:${measure.index}:${index}`;
      note.chordId = note.chordSize > 1 ? `${part.role}:${measure.index}:${note.voice}:${note.startQl}` : "";
    });
  }
}

function assembleParts(vocal, piano) {
  const parts = [];
  if (vocal.length <= 1) {
    const staff = vocal[0];
    if (staff) {
      const convention = assignOneStaff(staff.measures);
      const part = {
        id: "vocal",
        name: staff.meta.trackName || staff.meta.longName || "Vocal",
        role: "SA",
        staffLabel: "Vocal",
        convention,
        measures: staff.measures,
      };
      finishNotes(part);
      parts.push(part);
    }
  } else {
    const roles = [
      { role: "SA", pair: ["S", "A"], label: "SA" },
      { role: "TB", pair: ["T", "B"], label: "TB" },
    ];
    vocal.forEach((staff, index) => {
      const spec = roles[Math.min(index, roles.length - 1)];
      assignVoices(staff.measures, spec.pair, true);
      const part = {
        id: spec.role + index,
        name: staff.meta.trackName || staff.meta.longName || spec.label,
        role: index < 2 ? spec.role : "extra",
        staffLabel: spec.label,
        convention: "voices",
        measures: staff.measures,
      };
      finishNotes(part);
      parts.push(part);
    });
  }
  if (piano.length) parts.push(mergePiano(piano));
  return parts;
}

function mergePiano(staves) {
  const count = Math.max(0, ...staves.map((staff) => staff.measures.length));
  const measures = [];
  for (let index = 0; index < count; index++) {
    const template = staves.map((staff) => staff.measures[index]).find(Boolean);
    const notes = [];
    staves.forEach((staff, staffOrdinal) => {
      const measure = staff.measures[index];
      if (!measure) return;
      for (const note of measure.notes) {
        note.voice = String(staffOrdinal * 4 + note.voiceIndex + 1);
        note.parts = [];
        note.index = notes.length;
        note.id = `piano:${staff.staffIndex}:${index}:${note.index}`;
        notes.push(note);
      }
    });
    measures.push({
      index,
      number: String(index + 1),
      fifths: template?.fifths ?? 0,
      beats: template?.beats ?? 4,
      beatType: template?.beatType ?? 4,
      clef: template?.clef || { sign: "G", line: 2 },
      divisions: 480,
      harmonies: [],
      barlines: { left: null, right: null },
      notes,
    });
  }
  return { id: "piano", name: "Piano", role: "piano", measures };
}

export function openMscz(bytes, options = {}) {
  let entries;
  try {
    entries = readZip(bytes);
  } catch (error) {
    throw new Error(error.message === "Could not read that zip file." ? "Could not read that MuseScore file." : error.message);
  }
  const mscx = entries.find((entry) => /\.mscx$/i.test(entry.name));
  if (!mscx) throw new Error("This file is not a MuseScore score.");
  let xml;
  try {
    xml = new TextDecoder("utf-8").decode(entryData(mscx));
  } catch {
    throw new Error("Could not read that MuseScore file.");
  }
  const rejected = versionError(xml);
  if (rejected) throw new Error(rejected);
  const muse = parseDocument(xml).children.find((el) => el.tag === "museScore");
  const scoreEl = child(muse, "Score");
  if (!scoreEl) throw new Error("This file is not a MuseScore score.");
  const partDefs = [];
  for (const partEl of scoreEl.children.filter((el) => el.tag === "Part")) {
    const instrument = child(partEl, "Instrument");
    const staffCount = Math.max(1, partEl.children.filter((el) => el.tag === "Staff").length);
    partDefs.push({
      staffCount,
      trackName: plainText(xml, child(partEl, "trackName")),
      longName: plainText(xml, child(instrument, "longName")),
      shortName: plainText(xml, child(instrument, "shortName")),
      instrumentId: textOf(xml, child(instrument, "instrumentId")),
    });
  }
  const metas = [];
  for (const part of partDefs) {
    for (let i = 0; i < part.staffCount; i++) metas.push(part);
  }
  const staffEls = scoreEl.children.filter((el) => el.tag === "Staff" && el.attrs.id);
  const staves = staffEls.map((el, index) => parseStaff(xml, el, metas[index] || { staffCount: 1, trackName: "", longName: "", shortName: "", instrumentId: "" }, index));
  const unresolvedTies = linkTies(staves);
  const requested = Number.isInteger(options.vocalStaffIndex) ? options.vocalStaffIndex : null;
  let vocal;
  let piano;
  if (staves.some((staff) => isClearlyVocal(staff.meta))) {
    vocal = staves.filter((staff) => staff.kind === "vocal");
    piano = staves.filter((staff) => staff.kind === "piano");
  } else {
    const selected = selectUnlabeled(staves, requested);
    if (selected.needsStaffChoice) return { needsStaffChoice: true, choices: selected.choices };
    vocal = selected.vocal;
    piano = selected.piano;
  }
  const parts = assembleParts(vocal, piano);
  const quarterBpm = staves.map((staff) => staff.quarterBpm).find((tempo) => tempo != null) ?? 120;
  return {
    format: "mscz",
    tieTogether: true,
    xml,
    mscxName: mscx.name,
    zipEntries: entries,
    unresolvedTies,
    title: "Vocal score",
    quarterBpm,
    parts,
    nextAdd: 1,
  };
}

function msczAddedNote(note) {
  const indent = note.noteIndent || "            ";
  const inner = note.childIndent || `${indent}  `;
  const midi = pitchToMidi(note.pitch);
  const tpc = tpcFromPitch(note.pitch);
  const lines = [`${indent}<Note>`, `${inner}<pitch>${midi}</pitch>`, `${inner}<tpc>${tpc}</tpc>`];
  if (note.small) lines.push(`${inner}<small>1</small>`);
  if (note.visible === false) lines.push(`${inner}<visible>0</visible>`);
  lines.push(`${indent}</Note>`);
  return lines.join("\n");
}

export function msczReplacements(score) {
  const replacements = [];
  const inserts = new Map();
  const addInsert = (at, text) => {
    if (at == null || !text) return;
    inserts.set(at, `${inserts.get(at) || ""}${text}`);
  };
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const note of [...measure.notes, ...(measure.dropped || [])]) {
        if (note.removed && !note.added && note.elementSpan) {
          replacements.push({ ...note.elementSpan, text: "", kind: "delete-note" });
          continue;
        }
        if (!note.pitch || note.removed) continue;
        if (note.added) continue;
        if (note.pitchSpan && isEdited(note)) {
          const midi = pitchToMidi(note.pitch);
          const tpc = tpcFromPitch(note.pitch);
          replacements.push({ ...note.pitchSpan, text: String(midi), kind: "pitch" });
          if (note.tpcSpan) replacements.push({ ...note.tpcSpan, text: String(tpc), kind: "tpc" });
          const delta = tpc - note.originalTpc;
          if (note.tpc2Span && note.originalTpc2 != null) {
            replacements.push({ ...note.tpc2Span, text: String(note.originalTpc2 + delta), kind: "tpc2" });
          }
          if (note.accidentalSpan) {
            const written = tpcInfo(note.tpc2Span && note.originalTpc2 != null ? note.originalTpc2 + delta : tpc);
            const subtype = SUBTYPE[written.alter] || "accidentalNatural";
            replacements.push({ ...note.accidentalSpan, text: subtype, kind: "accidental" });
          }
        }
        const tags = [];
        if (note.small !== note.originalSmall) {
          if (note.small && !note.smallSpan) tags.push(`${note.childIndent || ""}<small>1</small>`);
          else if (!note.small && note.smallSpan) replacements.push({ ...note.smallSpan, text: "", kind: "small" });
        }
        if (note.visible !== note.originalVisible) {
          if (note.visible === false && !note.visibleSpan) tags.push(`${note.childIndent || ""}<visible>0</visible>`);
          else if (note.visible !== false && note.visibleSpan) replacements.push({ ...note.visibleSpan, text: "", kind: "visible" });
        }
        if (tags.length && note.tagInsertAt != null) addInsert(note.tagInsertAt, `${tags.join("\n")}\n`);
        if (note.stripTies) {
          for (const span of note.spannerSpans || []) replacements.push({ ...span, text: "", kind: "tie" });
        }
      }
      const added = measure.notes.filter((note) => note.added && !note.removed && note.insertAt != null);
      const byAt = new Map();
      for (const note of added) {
        if (!byAt.has(note.insertAt)) byAt.set(note.insertAt, []);
        byAt.get(note.insertAt).push(note);
      }
      for (const [at, notes] of byAt) {
        const block = notes.map(msczAddedNote).join("\n");
        const prefix = score.xml[at - 1] === "\n" ? "" : "\n";
        addInsert(at, `${prefix}${block}\n`);
      }
    }
  }
  for (const [at, text] of inserts) replacements.push({ start: at, end: at, text, kind: "insert" });
  return replacements.filter((rep) => rep.start != null && !(rep.start === rep.end && rep.text === ""));
}

function spliceXml(score) {
  return applyReplacements(score.xml, msczReplacements(score));
}

export function exportMscz(score) {
  const xml = spliceXml(score);
  const data = new TextEncoder().encode(xml);
  const entries = score.zipEntries.map((entry) => {
    if (entry.name !== score.mscxName) return entry;
    if (xml === score.xml) return entry;
    return { ...entry, data };
  });
  return writeZip(entries);
}

export { OLDER_FILE };
