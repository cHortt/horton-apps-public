// Parse a Piano Vocal file and write it back by splicing the original text.
// Unedited bytes stay as they were. An edit replaces that note's step, alter,
// and octave, plus an accidental element when the measure needs one printed.

import { accidentalName, pitchToMidi, samePitch } from "./theory.mjs";

const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;

function parseAttrs(source) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(source))) attrs[match[1]] = match[2] ?? match[3] ?? "";
  return attrs;
}

export function parseDocument(xml) {
  const root = { tag: "#root", attrs: {}, children: [], start: 0, end: xml.length, openEnd: 0, innerEnd: xml.length };
  const stack = [root];
  const re = new RegExp(TAG_RE.source, "g");
  let match;
  while ((match = re.exec(xml))) {
    if (match[0].startsWith("<!--") || match[0].startsWith("<?") || match[0].startsWith("<![")) continue;
    if (match[1]) {
      const el = stack.pop();
      if (!el || el.tag !== match[1]) throw new Error(`Mismatched </${match[1]}>`);
      el.innerEnd = match.index;
      el.end = re.lastIndex;
      continue;
    }
    const selfClosing = match[4] === "/";
    const el = {
      tag: match[2],
      attrs: parseAttrs(match[3] || ""),
      children: [],
      start: match.index,
      openEnd: re.lastIndex,
      innerEnd: selfClosing ? re.lastIndex : null,
      end: selfClosing ? re.lastIndex : null,
    };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1) throw new Error("Unclosed element in the score.");
  return root;
}

function parseTree(xml) {
  return parseDocument(xml).children.find((el) => el.tag === "score-partwise") || null;
}

export function child(el, tag) {
  return el?.children.find((c) => c.tag === tag) || null;
}

export function textOf(xml, el) {
  if (!el || el.innerEnd == null) return "";
  return xml.slice(el.openEnd, el.innerEnd).replace(/\s+/g, " ").trim();
}

function roleOf(name) {
  const n = name.toLowerCase();
  if (n.includes("piano")) return "piano";
  if (n.includes("tenor") || n === "tb") return "TB";
  if (n.includes("soprano") || n === "sa") return "SA";
  return "other";
}

function assignParts(role, voice, hasVoice2) {
  if (role === "SA") {
    if (!hasVoice2) return ["S", "A"];
    return voice === "2" ? ["A"] : ["S"];
  }
  if (role === "TB") {
    if (!hasVoice2) return ["T", "B"];
    return voice === "2" ? ["B"] : ["T"];
  }
  return [];
}

const SINGLE_STAFF_PARTS = ["S", "A", "T", "B"];

function voiceNumber(note) {
  if (Number.isInteger(note.voiceIndex)) return note.voiceIndex + 1;
  const n = Number(note.voice);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function onsetKey(note) {
  if (note.startFrac) return `${note.startFrac[0]}/${note.startFrac[1]}`;
  return String(Math.round(note.startQl * 1000) / 1000);
}

export function indentAt(xml, index) {
  let i = index;
  while (i > 0 && xml[i - 1] !== "\n") i--;
  const prefix = xml.slice(i, index);
  return /^\s*$/.test(prefix) ? prefix : "";
}

export function closingInsertAt(xml, innerEnd) {
  if (innerEnd == null) return null;
  const line = xml.lastIndexOf("\n", Math.max(0, innerEnd - 1));
  if (line >= 0 && xml.slice(line + 1, innerEnd).trim() === "") return line + 1;
  return innerEnd;
}

export function elementRemovalSpan(xml, el) {
  if (!el || el.end == null) return null;
  let start = el.start;
  const line = xml.lastIndexOf("\n", start);
  if (line >= 0 && xml.slice(line + 1, start).trim() === "") start = line;
  return { start, end: el.end };
}

export function applyReplacements(xml, replacements) {
  const sorted = [...replacements].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = xml;
  for (const rep of sorted) {
    if (rep.start == null || rep.text == null) continue;
    if (out.slice(rep.start, rep.end) === rep.text) continue;
    out = out.slice(0, rep.start) + rep.text + out.slice(rep.end);
  }
  return out;
}

function byPitchThenFile(a, b) {
  const delta = pitchToMidi(b.pitch) - pitchToMidi(a.pitch);
  return delta || a.chordNote - b.chordNote;
}

function clearStackFlags(note) {
  note.ambiguous = false;
  note.stackLower = false;
  note.unison = false;
}

// One vocal staff. A measure that uses another voice keeps each voice's part:
// voice 1 is Melody, 2 is High, 3 is Low, 4 is Bass. A voice that holds only
// rests does not count. A measure that stays in voice 1 stacks by file order,
// not by the note's current pitch: the top written note is Melody and the
// next one down is High, including a two-note chord. A stacked chord of exactly
// two notes is ambiguous: the lower note stays High until the user says it
// covers High, Low, or both. topFirst is MusicXML order (first note is the
// top). MuseScore stores a chord low to high, so the last note is the top.
export function assignSingleStaffParts(measures, { topFirst = false } = {}) {
  for (const measure of measures) {
    const pitched = measure.notes.filter((note) => note.pitch && !note.grace);
    const voices = new Set(pitched.map(voiceNumber));
    const voiceParts = voices.size > 1 || (voices.size === 1 && [...voices][0] !== 1);
    if (voiceParts) {
      for (const note of measure.notes) {
        note.parts = note.pitch && !note.grace ? [SINGLE_STAFF_PARTS[Math.min(voiceNumber(note) - 1, 3)]] : [];
        clearStackFlags(note);
      }
      continue;
    }
    const groups = new Map();
    for (const note of measure.notes) {
      if (!note.pitch || note.grace) {
        note.parts = [];
        clearStackFlags(note);
        continue;
      }
      const key = onsetKey(note);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    for (const group of groups.values()) {
      const ordered = group.slice().sort((a, b) => (topFirst ? a.chordNote - b.chordNote : b.chordNote - a.chordNote));
      ordered.forEach((note, index) => {
        note.parts = [SINGLE_STAFF_PARTS[Math.min(index, 3)]];
        clearStackFlags(note);
      });
      if (ordered.length === 2) {
        ordered[0].ambiguous = true;
        ordered[1].ambiguous = true;
        ordered[1].stackLower = true;
        if (ordered[1].partCover?.length) ordered[1].parts = [...ordered[1].partCover];
      }
    }
  }
}

export function usesSizeNotes(measures) {
  return measures.some((measure) => measure.notes.some((note) => note.pitch && !note.grace && note.small));
}

// Full-size notes are Melody. Small notes are harmony: the upper is High and
// the lower is Low. One small note is High only when it is above the melody;
// otherwise it is Low. An invisible small note is a unison part.
export function assignSizeParts(measures) {
  for (const measure of measures) {
    const groups = new Map();
    for (const note of measure.notes) {
      if (!note.pitch || note.grace) {
        note.parts = [];
        clearStackFlags(note);
        continue;
      }
      const key = `${note.voice}|${onsetKey(note)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    for (const group of groups.values()) {
      const full = group.filter((note) => !note.small).sort(byPitchThenFile);
      const melody = full[0] || null;
      const melodyMidi = melody ? pitchToMidi(melody.pitch) : null;
      for (const note of full) {
        note.parts = ["S"];
        clearStackFlags(note);
      }
      const smalls = group.filter((note) => note.small).sort(byPitchThenFile);
      if (smalls.length === 1) {
        const above = melodyMidi != null && pitchToMidi(smalls[0].pitch) > melodyMidi;
        smalls[0].parts = [above ? "A" : "T"];
      } else {
        const names = ["A", "T", "B"];
        smalls.forEach((note, index) => {
          note.parts = [names[Math.min(index, names.length - 1)]];
        });
      }
      for (const note of smalls) {
        note.ambiguous = false;
        note.stackLower = false;
        note.unison = note.visible === false;
      }
    }
  }
}

function accidentalMark(alterText) {
  const n = Number(alterText || 0);
  if (n === 1) return "#";
  if (n === -1) return "b";
  if (n === 2) return "x";
  if (n === -2) return "bb";
  return "";
}

function harmonyLabel(xml, el) {
  const root = child(el, "root");
  const kind = child(el, "kind");
  const bass = child(el, "bass");
  let label = textOf(xml, child(root, "root-step")) + accidentalMark(textOf(xml, child(root, "root-alter")));
  const printed = kind?.attrs.text ?? "";
  if (printed) label += printed;
  if (bass) {
    label += "/" + textOf(xml, child(bass, "bass-step")) + accidentalMark(textOf(xml, child(bass, "bass-alter")));
  }
  return label;
}

function readPitch(xml, pitchEl) {
  if (!pitchEl) return null;
  const alterText = textOf(xml, child(pitchEl, "alter"));
  return {
    step: textOf(xml, child(pitchEl, "step")),
    alter: alterText === "" ? 0 : Number(alterText),
    octave: Number(textOf(xml, child(pitchEl, "octave"))),
  };
}

function findTempo(xml, root) {
  // sound@tempo is quarters per minute. A metronome mark is converted from its beat unit.
  const found = { sound: null, metro: null };
  const walk = (el) => {
    if (el.tag === "sound" && el.attrs.tempo && found.sound == null) found.sound = Number(el.attrs.tempo);
    if (el.tag === "metronome" && found.metro == null) {
      const per = Number(textOf(xml, child(el, "per-minute")));
      const unit = textOf(xml, child(el, "beat-unit"));
      const base = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 }[unit] ?? 1;
      const ql = child(el, "beat-unit-dot") ? base * 1.5 : base;
      if (Number.isFinite(per)) found.metro = per * ql;
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
  return found.sound ?? found.metro ?? 120;
}

export function parseScore(xml) {
  const root = parseTree(xml);
  if (!root) throw new Error("This file is not a partwise MusicXML score.");
  const partList = child(root, "part-list");
  const names = new Map();
  for (const sp of partList?.children.filter((c) => c.tag === "score-part") || []) {
    names.set(sp.attrs.id, textOf(xml, child(sp, "part-name")));
  }
  const title =
    textOf(xml, child(child(root, "work"), "work-title")) ||
    textOf(xml, child(root, "movement-title")) ||
    "Vocal score";

  const parts = [];
  for (const partEl of root.children.filter((c) => c.tag === "part")) {
    const name = names.get(partEl.attrs.id) || partEl.attrs.id || "Part";
    const role = roleOf(name);
    let divisions = 1;
    let fifths = 0;
    let beats = 4;
    let beatType = 4;
    let clef = { sign: role === "TB" ? "F" : "G", line: role === "TB" ? 4 : 2 };
    const measures = [];
    partEl.children
      .filter((c) => c.tag === "measure")
      .forEach((mEl, mIndex) => {
        const attr = child(mEl, "attributes");
        if (attr) {
          const divText = textOf(xml, child(attr, "divisions"));
          if (divText) divisions = Number(divText);
          const key = child(attr, "key");
          if (key && textOf(xml, child(key, "fifths")) !== "") fifths = Number(textOf(xml, child(key, "fifths")));
          const time = child(attr, "time");
          if (time) {
            const b = textOf(xml, child(time, "beats"));
            const bt = textOf(xml, child(time, "beat-type"));
            if (b) beats = Number(b);
            if (bt) beatType = Number(bt);
          }
          const clefs = attr.children.filter((c) => c.tag === "clef");
          const main = clefs.find((c) => !c.attrs.number || c.attrs.number === "1") || clefs[0];
          if (main && role !== "piano") {
            clef = {
              sign: textOf(xml, child(main, "sign")) || clef.sign,
              line: Number(textOf(xml, child(main, "line")) || clef.line),
            };
          }
        }
        const notes = [];
        const harmonies = [];
        const barlines = { left: null, right: null };
        let cursor = 0;
        let lastStart = 0;
        let chordNote = 0;
        for (const el of mEl.children) {
          if (el.tag === "backup") {
            cursor -= Number(textOf(xml, child(el, "duration")) || 0) / divisions;
          } else if (el.tag === "forward") {
            cursor += Number(textOf(xml, child(el, "duration")) || 0) / divisions;
          } else if (el.tag === "harmony" && role !== "piano") {
            const offset = Number(textOf(xml, child(el, "offset")) || 0) / divisions;
            harmonies.push({ ql: cursor + offset, text: harmonyLabel(xml, el) });
          } else if (el.tag === "barline") {
            const loc = el.attrs.location || "right";
            const repeat = child(el, "repeat");
            const style = textOf(xml, child(el, "bar-style"));
            let kind = "regular";
            if (repeat?.attrs.direction === "forward") kind = "repeat-forward";
            else if (repeat?.attrs.direction === "backward") kind = "repeat-backward";
            else if (style === "light-light") kind = "double";
            else if (style === "light-heavy") kind = "final";
            else if (style === "heavy-light") kind = "heavy-light";
            barlines[loc === "left" ? "left" : "right"] = kind;
          } else if (el.tag === "note") {
            const isChord = el.children.some((c) => c.tag === "chord");
            const isGrace = el.children.some((c) => c.tag === "grace");
            chordNote = isChord ? chordNote + 1 : 0;
            const dur = Number(textOf(xml, child(el, "duration")) || 0) / divisions;
            const voice = textOf(xml, child(el, "voice")) || "1";
            const pitchEl = child(el, "pitch");
            const restEl = child(el, "rest");
            const accEl = child(el, "accidental");
            const start = isChord ? lastStart : cursor;
            if (!isChord && !isGrace) {
              lastStart = cursor;
              cursor += dur;
            }
            const pitch = readPitch(xml, pitchEl);
            const typeEl = child(el, "type");
            const typeText = textOf(xml, typeEl);
            const cue = typeEl?.attrs.size === "cue";
            const printObject = el.attrs["print-object"];
            const lyricEl = child(el, "lyric");
            const beamEls = el.children.filter((c) => c.tag === "beam");
            const chordEl = el.children.find((c) => c.tag === "chord");
            const tieSpans = [];
            for (const childEl of el.children) {
              if (childEl.tag === "tie") {
                const span = elementRemovalSpan(xml, childEl);
                if (span) tieSpans.push(span);
              } else if (childEl.tag === "notations") {
                const tied = childEl.children.filter((c) => c.tag === "tied");
                const other = childEl.children.some((c) => c.tag !== "tied");
                if (tied.length && !other) {
                  const span = elementRemovalSpan(xml, childEl);
                  if (span) tieSpans.push(span);
                } else {
                  for (const tiedEl of tied) {
                    const span = elementRemovalSpan(xml, tiedEl);
                    if (span) tieSpans.push(span);
                  }
                }
              }
            }
            notes.push({
              id: `${role}:${mIndex}:${notes.length}`,
              index: notes.length,
              measureIndex: mIndex,
              voice,
              isRest: !!restEl,
              measureRest: restEl?.attrs.measure === "yes",
              chord: isChord,
              chordNote,
              originalChordNote: chordNote,
              grace: isGrace,
              startQl: start,
              durQl: dur,
              pitch,
              originalPitch: pitch ? { ...pitch } : null,
              type: typeText || (restEl?.attrs.measure === "yes" ? "whole" : ""),
              dots: el.children.filter((c) => c.tag === "dot").length,
              stem: textOf(xml, child(el, "stem")) || "",
              beams: beamEls.map((b) => ({ number: Number(b.attrs.number || 1), type: textOf(xml, b) })),
              tieStart: el.children.some((c) => c.tag === "tie" && c.attrs.type === "start"),
              tieStop: el.children.some((c) => c.tag === "tie" && c.attrs.type === "stop"),
              lyric: lyricEl
                ? {
                    text: textOf(xml, child(lyricEl, "text")),
                    syllabic: textOf(xml, child(lyricEl, "syllabic")),
                  }
                : null,
              pitchRange: pitchEl ? { start: pitchEl.start, end: pitchEl.end } : null,
              accidentalRange: accEl ? { start: accEl.start, end: accEl.end } : null,
              accidental: accEl ? textOf(xml, accEl) : null,
              parts: [],
              small: !!cue && !isGrace,
              originalSmall: !!cue && !isGrace,
              visible: printObject !== "no",
              originalVisible: printObject !== "no",
              unison: false,
              added: false,
              removed: false,
              stripTies: false,
              ambiguous: false,
              stackLower: false,
              partCover: null,
              elementSpan: elementRemovalSpan(xml, el),
              noteOpenSpan: { start: el.start, end: el.openEnd },
              typeTagSpan: typeEl ? { start: typeEl.start, end: typeEl.openEnd } : null,
              chordTagSpan: chordEl ? elementRemovalSpan(xml, chordEl) : null,
              smallSpan: null,
              visibleSpan: null,
              spannerSpans: [],
              tieSpans,
              tagInsertAt: closingInsertAt(xml, el.innerEnd),
              childIndent: indentAt(xml, (pitchEl || typeEl || el).start) || "  ",
              noteIndent: indentAt(xml, el.start),
              insertAt: null,
              chordKey: `${role}:${mIndex}|${voice}|${start}`,
              chordSpan: null,
              lyricXml: lyricEl ? xml.slice(lyricEl.start, lyricEl.end) : null,
              beamXml: beamEls.length ? beamEls.map((beam) => xml.slice(beam.start, beam.end)).join("\n") : null,
              durationText: textOf(xml, child(el, "duration")),
            });
          }
        }
        const hasVoice2 = notes.some((n) => n.voice === "2");
        for (const n of notes) n.parts = assignParts(role, n.voice, hasVoice2);
        const chordGroups = new Map();
        for (const note of notes) {
          if (!note.pitch || note.grace) continue;
          if (!chordGroups.has(note.chordKey)) chordGroups.set(note.chordKey, []);
          chordGroups.get(note.chordKey).push(note);
        }
        for (const group of chordGroups.values()) {
          const span = {
            start: Math.min(...group.map((note) => note.elementSpan?.start ?? note.noteOpenSpan.start)),
            end: Math.max(...group.map((note) => note.elementSpan?.end ?? note.noteOpenSpan.end)),
          };
          const at = group[group.length - 1].elementSpan?.end ?? group[group.length - 1].noteOpenSpan.end;
          for (const note of group) {
            note.chordSpan = span;
            note.insertAt = at;
          }
        }
        measures.push({
          index: mIndex,
          number: mEl.attrs.number || String(mIndex + 1),
          fifths,
          beats,
          beatType,
          clef: { ...clef },
          divisions,
          harmonies,
          barlines,
          notes,
        });
      });
    parts.push({ id: partEl.attrs.id, name, role, measures });
    linkMusicXmlTies(parts[parts.length - 1]);
  }

  // SA plus TB keeps the two-staff voice pairs. One vocal part is the
  // single-staff layout, including a part that is not named Soprano or Tenor.
  // Cue-size notes on that one staff are the size convention.
  const vocals = parts.filter((part) => part.role !== "piano");
  const paired = parts.some((part) => part.role === "SA") && parts.some((part) => part.role === "TB");
  if (!paired && vocals.length === 1) {
    const vocal = vocals[0];
    vocal.role = "SA";
    vocal.staffLabel = "Vocal";
    vocal.convention = usesSizeNotes(vocal.measures) ? "size" : "legacy";
    if (vocal.convention === "size") assignSizeParts(vocal.measures);
    else assignSingleStaffParts(vocal.measures, { topFirst: true });
    for (const measure of vocal.measures) {
      measure.notes.forEach((note, index) => {
        note.id = `SA:${measure.index}:${index}`;
        note.index = index;
      });
      const groups = new Map();
      for (const note of measure.notes) {
        if (!note.pitch || note.grace) continue;
        const key = `${note.voice}:${onsetKey(note)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(note);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const id = `SA:${measure.index}:${group[0].index}`;
        for (const note of group) note.chordId = id;
      }
    }
  }

  return {
    xml,
    title,
    quarterBpm: findTempo(xml, root),
    parts,
    nextAdd: 1,
  };
}

function linkMusicXmlTies(part) {
  const hanging = new Map();
  let serial = 0;
  for (const measure of part.measures) {
    const notes = measure.notes
      .filter((note) => note.pitch && !note.grace)
      .slice()
      .sort((a, b) => a.startQl - b.startQl || a.index - b.index);
    for (const note of notes) {
      const key = `${note.voice}|${pitchToMidi(note.pitch)}`;
      if (note.tieStop && hanging.has(key)) {
        const prev = hanging.get(key);
        const id = prev.tieGroup || `xmltie:${part.id}:${serial++}`;
        prev.tieGroup = id;
        note.tieGroup = id;
        if (note.tieStart) hanging.set(key, note);
        else hanging.delete(key);
      } else if (note.tieStart) hanging.set(key, note);
    }
  }
}

export function findNote(score, id) {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      const note = measure.notes.find((n) => n.id === id);
      if (note) return { note, measure, part };
    }
  }
  return null;
}

export function setPitch(score, id, pitch) {
  const found = findNote(score, id);
  if (!found?.note.pitch) throw new Error("That note has no pitch to edit.");
  const next = { step: pitch.step, alter: pitch.alter || 0, octave: pitch.octave };
  // A tie is one sounding note. MuseScore rejects a tie whose ends disagree,
  // so an .mscz edit moves every note in that tie together.
  const targets =
    score.tieTogether && found.note.tieGroup
      ? iterNotes(score).filter((note) => note.tieGroup === found.note.tieGroup && note.pitch)
      : [found.note];
  for (const note of targets) note.pitch = { ...next };
  if (found.part.convention === "size") {
    const touched = found.part.measures.filter((measure) => measure.notes.some((note) => targets.includes(note)));
    assignSizeParts(touched);
  }
  return found;
}

export function updatePitchBlock(block, pitch) {
  let next = block.replace(/<step>[A-G]<\/step>/, `<step>${pitch.step}</step>`);
  next = next.replace(/<octave>-?\d+<\/octave>/, `<octave>${pitch.octave}</octave>`);
  const alter = pitch.alter || 0;
  if (!alter) {
    next = next.replace(/\r?\n[ \t]*<alter>[^<]*<\/alter>/, "");
  } else if (next.includes("<alter>")) {
    next = next.replace(/<alter>[^<]*<\/alter>/, `<alter>${formatAlterLocal(alter)}</alter>`);
  } else {
    next = next.replace(
      /(<step>[A-G]<\/step>\r?\n)([ \t]*)/,
      `$1$2<alter>${formatAlterLocal(alter)}</alter>\n$2`,
    );
  }
  return next;
}

function formatAlterLocal(alter) {
  return String(Math.round(alter));
}

function lineIndentAt(xml, index) {
  let i = index;
  while (i > 0 && xml[i - 1] !== "\n") i--;
  return xml.slice(i, index);
}

// Accidentals follow the key signature until a note in the same octave prints
// a different one. Tied notes keep the accidental on the first note only when
// the sounding alter has not changed.
function requiredAccidentals(part) {
  const out = new Map();
  for (const measure of part.measures) {
    const initial = keyState(measure.fifths);
    const state = new Map();
    const groups = new Map();
    for (const note of measure.notes) {
      if (!note.pitch) continue;
      const key = note.startQl.toFixed(4);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    for (const group of [...groups.keys()].sort((a, b) => Number(a) - Number(b)).map((k) => groups.get(k))) {
      const decided = [];
      for (const note of group) {
        if (note.added) continue;
        const slot = `${note.pitch.step}:${note.pitch.octave}`;
        const current = state.has(slot) ? state.get(slot) : initial[note.pitch.step] || 0;
        const alter = note.pitch.alter || 0;
        decided.push([note, alter === current ? null : accidentalName(alter)]);
      }
      for (const [note, name] of decided) {
        out.set(note.id, name);
        state.set(`${note.pitch.step}:${note.pitch.octave}`, note.pitch.alter || 0);
      }
    }
  }
  return out;
}

function keyState(fifths) {
  const alters = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const sh = ["F", "C", "G", "D", "A", "E", "B"];
  const fl = ["B", "E", "A", "D", "G", "C", "F"];
  if (fifths > 0) for (let i = 0; i < fifths; i++) alters[sh[i]] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths; i++) alters[fl[i]] = -1;
  return alters;
}

function withAttribute(openTag, name, value) {
  let tag = openTag.replace(new RegExp(`\\s*${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`), "");
  if (value == null) return tag;
  return tag.replace(/\/?>$/, (end) => ` ${name}="${value}"${end}`);
}

function musicXmlAddedNote(note, fifths) {
  const indent = note.noteIndent || "        ";
  const inner = note.childIndent || `${indent}  `;
  const alter = note.pitch.alter || 0;
  const alterXml = alter ? `\n${inner}  <alter>${formatAlterLocal(alter)}</alter>` : "";
  const key = keyState(fifths || 0);
  const accidental = alter === (key[note.pitch.step] || 0) ? "" : `\n${inner}<accidental>${accidentalName(alter)}</accidental>`;
  const dots = note.dots ? `\n${inner}<dot/>`.repeat(note.dots) : "";
  const stem = note.stem ? `\n${inner}<stem>${note.stem}</stem>` : "";
  const cue = note.small ? ' size="cue"' : "";
  const hidden = note.visible === false ? ' print-object="no"' : "";
  const duration = note.durationText || "1";
  return `${indent}<note${hidden}>\n${inner}<chord/>\n${inner}<pitch>\n${inner}  <step>${note.pitch.step}</step>${alterXml}\n${inner}  <octave>${note.pitch.octave}</octave>\n${inner}</pitch>\n${inner}<duration>${duration}</duration>\n${inner}<voice>${note.voice || "1"}</voice>\n${inner}<type${cue}>${note.type || "quarter"}</type>${dots}${accidental}${stem}\n${indent}</note>`;
}

function pushInsert(buckets, at, text) {
  if (at == null || !text) return;
  buckets.set(at, `${buckets.get(at) || ""}${text}`);
}

export function scoreReplacements(score) {
  const replacements = [];
  const inserts = new Map();
  for (const part of score.parts) {
    const needed = part.role === "piano" ? new Map() : requiredAccidentals(part);
    const pool = [];
    for (const measure of part.measures) pool.push(...measure.notes, ...(measure.dropped || []));
    const byChord = new Map();
    for (const note of pool) {
      if (!note.chordKey) continue;
      if (!byChord.has(note.chordKey)) byChord.set(note.chordKey, []);
      byChord.get(note.chordKey).push(note);
    }
    for (const group of byChord.values()) {
      const dropped = group.filter((note) => note.removed && !note.added && note.elementSpan);
      const live = group.filter((note) => !note.removed);
      const liveOriginal = live.filter((note) => !note.added);
      for (const note of dropped) replacements.push({ ...note.elementSpan, text: "", kind: "delete-note" });
      const headGone = dropped.some((note) => note.originalChordNote === 0);
      if (headGone && liveOriginal.length) {
        const newHead = liveOriginal.slice().sort((a, b) => a.originalChordNote - b.originalChordNote)[0];
        if (newHead.chordTagSpan) replacements.push({ ...newHead.chordTagSpan, text: "", kind: "chord-tag" });
        const lyric = liveOriginal.some((note) => note.lyricXml) ? null : dropped.map((note) => note.lyricXml).find(Boolean);
        const beams = newHead.beamXml ? null : dropped.map((note) => note.beamXml).find(Boolean);
        const extra = `${beams ? `\n${newHead.childIndent || ""}${beams}` : ""}${lyric ? `\n${newHead.childIndent || ""}${lyric}` : ""}`;
        if (extra && newHead.tagInsertAt != null) pushInsert(inserts, newHead.tagInsertAt, `${extra}\n`);
      }
    }
    for (const measure of part.measures) {
      for (const note of [...measure.notes, ...(measure.dropped || [])]) {
        if (!note.pitch) continue;
        if (note.removed || note.added) continue;
        if (note.pitchRange) {
          const block = score.xml.slice(note.pitchRange.start, note.pitchRange.end);
          const updated = updatePitchBlock(block, note.pitch);
          if (updated !== block) replacements.push({ start: note.pitchRange.start, end: note.pitchRange.end, text: updated, kind: "pitch" });
          const want = needed.get(note.id) || null;
          const have = note.accidental;
          if (want !== have) {
            if (want && note.accidentalRange) {
              const current = score.xml.slice(note.accidentalRange.start, note.accidentalRange.end);
              const text = current.replace(/>([^<]*)</, `>${want}<`);
              if (text !== current) replacements.push({ start: note.accidentalRange.start, end: note.accidentalRange.end, text, kind: "accidental" });
            } else if (want && !note.accidentalRange) {
              const indent = lineIndentAt(score.xml, note.pitchRange.start);
              replacements.push({
                start: note.pitchRange.end,
                end: note.pitchRange.end,
                text: `\n${indent}<accidental>${want}</accidental>`,
                kind: "accidental",
              });
            } else if (!want && note.accidentalRange) {
              let start = note.accidentalRange.start;
              const line = score.xml.lastIndexOf("\n", start);
              if (line >= 0 && score.xml.slice(line + 1, start).trim() === "") start = line;
              replacements.push({ start, end: note.accidentalRange.end, text: "", kind: "accidental" });
            }
          }
        }
        if (note.small !== note.originalSmall && note.typeTagSpan) {
          const current = score.xml.slice(note.typeTagSpan.start, note.typeTagSpan.end);
          const text = withAttribute(current, "size", note.small ? "cue" : null);
          if (text !== current) replacements.push({ ...note.typeTagSpan, text, kind: "type-size" });
        }
        if (note.visible !== note.originalVisible && note.noteOpenSpan) {
          const current = score.xml.slice(note.noteOpenSpan.start, note.noteOpenSpan.end);
          const text = withAttribute(current, "print-object", note.visible === false ? "no" : null);
          if (text !== current) replacements.push({ ...note.noteOpenSpan, text, kind: "print" });
        }
        if (note.stripTies) {
          for (const span of note.tieSpans || []) replacements.push({ ...span, text: "", kind: "tie" });
        }
      }
      const added = measure.notes.filter((note) => note.added && !note.removed);
      const byAt = new Map();
      for (const note of added) {
        if (note.insertAt == null) continue;
        if (!byAt.has(note.insertAt)) byAt.set(note.insertAt, []);
        byAt.get(note.insertAt).push(note);
      }
      for (const [at, notes] of byAt) {
        const block = notes.map((note) => musicXmlAddedNote(note, measure.fifths)).join("\n");
        const prefix = score.xml[at - 1] === "\n" ? "" : "\n";
        pushInsert(inserts, at, `${prefix}${block}\n`);
      }
    }
  }
  for (const [at, text] of inserts) {
    if (text) replacements.push({ start: at, end: at, text, kind: "insert" });
  }
  return replacements.filter((rep) => rep.start != null && !(rep.start === rep.end && rep.text === ""));
}

export function exportScore(score) {
  return applyReplacements(score.xml, scoreReplacements(score));
}

export const MXL_ERROR =
  "Compressed .mxl files aren't supported. Export uncompressed MusicXML (.musicxml) and open that.";

export const NO_STAFF_ERROR = "This file has no staff with notes to edit.";

// The file picker accepts every file. This checks the name and the bytes
// before the score parser runs. .mxl is a zip package, which this editor does not read.
export function rejectOpenedFile(filename, text) {
  const name = String(filename || "");
  if (/\.mscz$/i.test(name)) return "";
  if (/\.mxl$/i.test(name)) return MXL_ERROR;
  if (text == null) return "";
  const body = String(text);
  if (body.startsWith("PK")) return MXL_ERROR;
  if (!/<\s*score-(?:partwise|timewise)\b/.test(body)) {
    return "This file is not a MusicXML score. Open an uncompressed .musicxml file.";
  }
  return "";
}

export function editedName(filename) {
  const name = String(filename || "score.musicxml");
  const mscz = name.match(/^(.*)\.mscz$/i);
  if (mscz) return `${mscz[1]} (edited).mscz`;
  const match = name.match(/^(.*)(\.musicxml|\.xml)$/i);
  if (match) return `${match[1]} (edited)${match[2]}`;
  return `${name} (edited).musicxml`;
}

export function playbackEvents(score) {
  const events = [];
  for (const part of score.parts) {
    if (part.role === "piano") events.push(...eventsFor(part, "P"));
    else if (part.role === "SA" || part.role === "extra") {
      // A one-staff MuseScore score keeps melody and both harmony parts here.
      events.push(...eventsFor(part, "S"));
      events.push(...eventsFor(part, "A"));
      events.push(...eventsFor(part, "T"));
      events.push(...eventsFor(part, "B"));
    } else if (part.role === "TB") {
      events.push(...eventsFor(part, "T"));
      events.push(...eventsFor(part, "B"));
    }
  }
  events.sort((a, b) => a.ql - b.ql || a.channel.localeCompare(b.channel));
  return events;
}

function eventsFor(part, channel) {
  const out = [];
  const hanging = new Map();
  let origin = 0;
  for (const measure of part.measures) {
    const measureLen = measure.beats * (4 / measure.beatType);
    const notes = measure.notes
      .filter((n) => channel === "P" || n.parts.includes(channel))
      .filter((n) => n.pitch && !n.grace)
      .slice()
      .sort((a, b) => a.startQl - b.startQl || a.index - b.index);
    for (const note of notes) {
      const start = origin + note.startQl;
      const end = start + note.durQl;
      const midi = pitchToMidi(note.pitch);
      const key = `${note.voice}|${midi}`;
      const prev = hanging.get(key);
      if (note.tieStop && prev && prev.midi === midi) {
        prev.durQl = end - prev.ql;
        if (!note.tieStart) hanging.delete(key);
        continue;
      }
      const event = { ql: start, durQl: note.durQl, midi, channel, id: note.id };
      out.push(event);
      if (note.tieStart) hanging.set(key, event);
    }
    origin += measureLen;
  }
  return out;
}

export function isEdited(note) {
  return !!note.pitch && !samePitch(note.pitch, note.originalPitch);
}

export function iterNotes(score) {
  const notes = [];
  for (const part of score.parts) for (const measure of part.measures) notes.push(...measure.notes);
  return notes;
}
