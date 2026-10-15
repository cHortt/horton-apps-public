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

function parseTree(xml) {
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
  if (stack.length !== 1) throw new Error("Unclosed element in MusicXML");
  return root.children.find((el) => el.tag === "score-partwise") || null;
}

function child(el, tag) {
  return el?.children.find((c) => c.tag === tag) || null;
}

function textOf(xml, el) {
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
        for (const el of mEl.children) {
          if (el.tag === "backup") {
            cursor -= Number(textOf(xml, child(el, "duration")) || 0) / divisions;
          } else if (el.tag === "forward") {
            cursor += Number(textOf(xml, child(el, "duration")) || 0) / divisions;
          } else if (el.tag === "harmony" && role === "SA") {
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
            const typeText = textOf(xml, child(el, "type"));
            notes.push({
              id: `${role}:${mIndex}:${notes.length}`,
              index: notes.length,
              voice,
              isRest: !!restEl,
              measureRest: restEl?.attrs.measure === "yes",
              chord: isChord,
              grace: isGrace,
              startQl: start,
              durQl: dur,
              pitch,
              originalPitch: pitch ? { ...pitch } : null,
              type: typeText || (restEl?.attrs.measure === "yes" ? "whole" : ""),
              dots: el.children.filter((c) => c.tag === "dot").length,
              stem: textOf(xml, child(el, "stem")) || "",
              beams: el.children
                .filter((c) => c.tag === "beam")
                .map((b) => ({ number: Number(b.attrs.number || 1), type: textOf(xml, b) })),
              tieStart: el.children.some((c) => c.tag === "tie" && c.attrs.type === "start"),
              tieStop: el.children.some((c) => c.tag === "tie" && c.attrs.type === "stop"),
              lyric: child(el, "lyric")
                ? {
                    text: textOf(xml, child(child(el, "lyric"), "text")),
                    syllabic: textOf(xml, child(child(el, "lyric"), "syllabic")),
                  }
                : null,
              pitchRange: pitchEl ? { start: pitchEl.start, end: pitchEl.end } : null,
              accidentalRange: accEl ? { start: accEl.start, end: accEl.end } : null,
              accidental: accEl ? textOf(xml, accEl) : null,
              parts: [],
            });
          }
        }
        const hasVoice2 = notes.some((n) => n.voice === "2");
        for (const n of notes) n.parts = assignParts(role, n.voice, hasVoice2);
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
  }

  return {
    xml,
    title,
    quarterBpm: findTempo(xml, root),
    parts,
  };
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
  found.note.pitch = { step: pitch.step, alter: pitch.alter || 0, octave: pitch.octave };
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

export function exportScore(score) {
  const replacements = [];
  for (const part of score.parts) {
    const needed = requiredAccidentals(part);
    for (const measure of part.measures) {
      for (const note of measure.notes) {
        if (!note.pitch || !note.pitchRange) continue;
        const block = score.xml.slice(note.pitchRange.start, note.pitchRange.end);
        const updated = updatePitchBlock(block, note.pitch);
        if (updated !== block) {
          replacements.push({ start: note.pitchRange.start, end: note.pitchRange.end, text: updated });
        }
        const want = needed.get(note.id) || null;
        const have = note.accidental;
        if (want === have) continue;
        if (want && note.accidentalRange) {
          const current = score.xml.slice(note.accidentalRange.start, note.accidentalRange.end);
          const text = current.replace(/>([^<]*)</, `>${want}<`);
          if (text !== current) {
            replacements.push({ start: note.accidentalRange.start, end: note.accidentalRange.end, text });
          }
        } else if (want && !note.accidentalRange) {
          const indent = lineIndentAt(score.xml, note.pitchRange.start);
          replacements.push({
            start: note.pitchRange.end,
            end: note.pitchRange.end,
            text: `\n${indent}<accidental>${want}</accidental>`,
          });
        } else if (!want && note.accidentalRange) {
          let start = note.accidentalRange.start;
          const line = score.xml.lastIndexOf("\n", start);
          if (line >= 0 && score.xml.slice(line + 1, start).trim() === "") start = line;
          replacements.push({ start, end: note.accidentalRange.end, text: "" });
        }
      }
    }
  }
  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = score.xml;
  for (const rep of replacements) out = out.slice(0, rep.start) + rep.text + out.slice(rep.end);
  return out;
}

export const MXL_ERROR =
  "Compressed .mxl files aren't supported. Export uncompressed MusicXML (.musicxml) and open that.";

// The file picker accepts every file. This checks the name and the bytes
// before the score parser runs. .mxl is a zip package, which this editor does not read.
export function rejectOpenedFile(filename, text) {
  const name = String(filename || "");
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
  const match = String(filename || "score.musicxml").match(/^(.*)(\.musicxml|\.xml)$/i);
  if (match) return `${match[1]} (edited)${match[2]}`;
  return `${filename || "score"} (edited).musicxml`;
}

export function playbackEvents(score) {
  const events = [];
  for (const part of score.parts) {
    if (part.role === "piano") events.push(...eventsFor(part, "P"));
    else if (part.role === "SA") {
      events.push(...eventsFor(part, "S"));
      events.push(...eventsFor(part, "A"));
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
