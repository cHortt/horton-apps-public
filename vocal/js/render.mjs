// Continuous two-staff vocal engraving. The piano staves are never drawn.
// Hit targets are returned separately so a tap can ignore every part except the active one.

import { isEdited } from "./musicxml.mjs";
import { NO_STAFF_ERROR } from "./musicxml.mjs";
import { staffStep } from "./theory.mjs";

export const PART_COLORS = { S: "#d61f2c", A: "#e86a12", T: "#178a38", B: "#1d4ed8" };

const LG = 12;
const STEP = LG / 2;
const SA_TOP = 42;
const STAFF_H = LG * 4;
const TB_TOP = SA_TOP + STAFF_H + 78;
const HEIGHT = TB_TOP + STAFF_H + 36;

const SHARP_STEPS = {
  G: [8, 5, 9, 6, 3, 7, 4],
  F: [6, 3, 7, 4, 1, 5, 2],
};
const FLAT_STEPS = {
  G: [4, 7, 3, 6, 2, 5, 1],
  F: [2, 5, 1, 4, 0, 3, -1],
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function roundQl(ql) {
  return Math.round(ql * 1000) / 1000;
}

function yOn(staffTop, step) {
  return staffTop + (8 - step) * STEP;
}

function slotWidth(dq) {
  if (dq >= 4) return 92;
  if (dq >= 2) return 68;
  if (dq >= 1) return 50;
  if (dq >= 0.75) return 42;
  if (dq >= 0.5) return 36;
  if (dq >= 0.25) return 26;
  return 22;
}

function keyCount(fifths) {
  return Math.min(7, Math.abs(fifths));
}

function gutterWidth(fifths) {
  return 28 + 40 + keyCount(fifths) * 11 + 28;
}

export function renderScore(score, state) {
  const sa = score.parts.find((p) => p.role === "SA");
  const tb = score.parts.find((p) => p.role === "TB") || null;
  if (!sa) throw new Error(NO_STAFF_ERROR);
  const count = tb ? Math.min(sa.measures.length, tb.measures.length) : sa.measures.length;
  const fifths = sa.measures[0]?.fifths ?? 0;
  const gutter = gutterWidth(fifths);
  const measures = [];
  const placed = [];
  let x = 8;
  let origin = 0;
  for (let i = 0; i < count; i++) {
    const measure = layoutMeasure(sa.measures[i], tb ? tb.measures[i] : null, x, origin);
    measures.push(measure);
    placed.push(...measure.notes);
    x += measure.w;
    origin = measure.endQl;
  }
  const width = Math.max(x + 12, 320);
  const height = tb ? HEIGHT : SA_TOP + STAFF_H + 36;
  const tops = tb ? [SA_TOP, TB_TOP] : [SA_TOP];
  const gutterSvg = tb
    ? drawGutter(gutter, sa.measures[0], tb.measures[0])
    : drawSingleGutter(gutter, sa.measures[0], height, sa.staffLabel || "Vocal");
  const spec = { measures, notes: placed, width, height, tops, gutterSvg, gutterW: gutter, endQl: origin };
  if (!state.wrapWidth) {
    const music = drawMusic(width, measures, placed, state, tops, height);
    return { gutter: gutterSvg, music, width, height, gutterWidth: gutter, measures, notes: placed, endQl: origin, systems: null, wrapWidth: 0 };
  }
  const systems = layoutSystems(spec, state);
  return {
    gutter: gutterSvg,
    music: systems.map((system) => system.svg).join(""),
    width,
    height,
    gutterWidth: gutter,
    measures,
    notes: placed,
    endQl: origin,
    systems,
    wrapWidth: state.wrapWidth,
  };
}

function svgInner(svg) {
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
}

// Cast off measures into systems that fit wrapWidth. The first system keeps the
// full clef, key, and time gutter. Later systems clip off the time-signature
// column (27px; 107 → 80 with one sharp) so each line carries clef and key only.
function layoutSystems(spec, state) {
  const { measures, width, height, tops, gutterSvg, gutterW } = spec;
  const avail = state.wrapWidth;
  const shortW = Math.max(48, gutterW - 27);
  const edges = [0];
  for (let i = 1; i < measures.length; i++) edges.push(measures[i].x);
  edges.push(width);
  const count = edges.length - 1;
  const rows = [];
  let i = 0;
  while (i < count) {
    const gw = i === 0 ? gutterW : shortW;
    let j = i + 1;
    while (j < count && gw + edges[j + 1] - edges[i] <= avail) j++;
    rows.push({ i, j, gw, start: edges[i], end: edges[j] });
    i = j;
  }
  const scale = Math.min(1.35, ...rows.map((row) => avail / (row.gw + row.end - row.start)));
  const y1 = tops[0] - 10;
  const y2 = tops[tops.length - 1] + STAFF_H + 10;
  const gutterInner = svgInner(gutterSvg);
  return rows.map((row, index) => {
    const mw = row.end - row.start;
    const dx = -row.start;
    const sliceMeasures = measures.slice(row.i, row.j).map((measure) => ({
      ...measure,
      x: measure.x + dx,
      xAt: (ql) => measure.xAt(ql) + dx,
      harmonies: measure.harmonies.map((harmony) => ({ ...harmony, x: harmony.x + dx })),
    }));
    const sliceNotes = [];
    for (const measure of measures.slice(row.i, row.j)) {
      measure.systemIndex = index;
      measure.hitX = measure.x + dx + row.gw;
      for (const note of measure.notes) {
        note.systemIndex = index;
        note.hitX = note.x + dx + row.gw;
        note.hitY = note.y;
        sliceNotes.push({ ...note, x: note.x + dx });
      }
    }
    const musicInner = svgInner(drawMusic(mw, sliceMeasures, sliceNotes, state, tops, height)).replace(
      'id="cursor"',
      `class="playhead" data-index="${index}"`,
    );
    const gutter = `<svg x="0" y="0" width="${row.gw}" height="${height}" viewBox="0 0 ${row.gw} ${height}">${gutterInner}</svg>`;
    const musicSvg = `<svg x="${row.gw}" y="0" width="${mw}" height="${height}" viewBox="0 0 ${mw} ${height}">${musicInner}</svg>`;
    const dispW = (row.gw + mw) * scale;
    const dispH = height * scale;
    const svg = `<svg class="system" data-index="${index}" data-first="${row.i}" data-last="${row.j - 1}" width="${dispW.toFixed(1)}" height="${dispH.toFixed(1)}" viewBox="0 0 ${row.gw + mw} ${height}" xmlns="http://www.w3.org/2000/svg">${gutter}${musicSvg}</svg>`;
    return {
      index,
      first: row.i,
      last: row.j - 1,
      gw: row.gw,
      start: row.start,
      end: row.end,
      scale,
      y1,
      y2,
      svg,
      notes: measures.slice(row.i, row.j).flatMap((measure) => measure.notes),
      measures: measures.slice(row.i, row.j),
    };
  });
}

export function hitTest(layout, systemIndex, x, y, activePart) {
  const system = layout.systems?.[systemIndex];
  if (!system) return null;
  if (y < 30 && x >= system.gw) {
    const measure = system.measures.find((item) => x >= item.hitX && x < item.hitX + item.w);
    if (measure) return { type: "bar", measure };
  }
  let best = null;
  let bestD = 26 * 26;
  for (const note of system.notes) {
    if (note.isRest || note.badge || !note.parts?.includes(activePart)) continue;
    const d = (note.hitX - x) ** 2 + (note.hitY - y) ** 2;
    if (d < bestD) {
      best = note;
      bestD = d;
    }
  }
  if (best) return { type: "note", note: best };
  const measure = system.measures.find((item) => x >= item.hitX && x < item.hitX + item.w);
  if (measure) return { type: "empty", measure };
  return null;
}

function layoutMeasure(sa, tb, x, originQl) {
  const beats = sa.beats * (4 / sa.beatType);
  const onsets = new Set([0, roundQl(beats)]);
  for (const note of [...sa.notes, ...(tb ? tb.notes : [])]) onsets.add(roundQl(note.startQl));
  for (const harmony of sa.harmonies) onsets.add(roundQl(harmony.ql));
  const points = [...onsets].sort((a, b) => a - b);
  const left = sa.barlines.left || tb?.barlines.left ? 16 : 8;
  let cursor = left;
  const at = new Map();
  for (let i = 0; i < points.length - 1; i++) {
    at.set(points[i], cursor);
    let width = slotWidth(points[i + 1] - points[i]);
    for (const note of [...sa.notes, ...(tb ? tb.notes : [])]) {
      if (!note.lyric || roundQl(note.startQl) !== points[i]) continue;
      width = Math.max(width, Math.min(84, note.lyric.text.length * 7.4 + 10));
    }
    for (const harmony of sa.harmonies) {
      if (Math.abs(harmony.ql - points[i]) > 0.02) continue;
      width = Math.max(width, harmony.text.length * 8.2 + 8);
    }
    cursor += width;
  }
  at.set(points[points.length - 1], cursor);
  const w = cursor + 16;
  const xAt = (ql) => {
    const q = Math.max(0, Math.min(beats, ql));
    let prev = points[0];
    for (const point of points) {
      if (point >= q) {
        const x0 = at.get(prev);
        const x1 = at.get(point);
        const span = point - prev || 1;
        return x + x0 + ((q - prev) / span) * (x1 - x0);
      }
      prev = point;
    }
    return x + at.get(points[points.length - 1]);
  };
  const notes = [];
  const add = (note, staffTop, clef) => {
    if (note.grace) return;
    const step = note.pitch ? staffStep(note.pitch.step, note.pitch.octave, clef) : null;
    const nx = note.measureRest ? x + w / 2 : xAt(note.startQl) + 9;
    const ny = step == null ? yOn(staffTop, 4) : yOn(staffTop, step);
    notes.push({
      id: note.id,
      x: nx,
      y: ny,
      step,
      parts: note.parts,
      voice: note.voice,
      measureIndex: sa.index,
      startQl: note.startQl,
      type: note.type,
      dots: note.dots,
      stem: note.stem,
      beams: note.beams,
      isRest: note.isRest,
      measureRest: note.measureRest,
      lyric: note.lyric,
      tieStart: note.tieStart,
      tieStop: note.tieStop,
      chordId: note.chordId || "",
      staffTop,
      edited:
        isEdited(note) ||
        !!note.added ||
        (note.originalSmall != null && note.small !== note.originalSmall) ||
        (note.originalVisible != null && note.visible !== note.originalVisible),
      absQl: originQl + note.startQl,
      small: !!note.small,
      unison: !!note.unison,
      ambiguous: !!note.ambiguous,
      stackLower: !!note.stackLower,
      partCover: note.partCover || null,
      pitchLabel: note.pitch ? `${note.pitch.step}${note.pitch.octave}` : "",
      measureNumber: String(sa.number),
    });
  };
  for (const note of sa.notes) add(note, SA_TOP, sa.clef.sign);
  if (tb) for (const note of tb.notes) add(note, TB_TOP, tb.clef.sign);
  groupChordStems(notes);
  placeUnisonBadges(notes);
  return {
    x,
    w,
    number: sa.number,
    index: sa.index,
    startQl: originQl,
    endQl: originQl + beats,
    beats,
    xAt,
    harmonies: sa.harmonies.map((h) => ({ ...h, x: xAt(h.ql) + 9 })),
    barlines: { left: sa.barlines.left || tb?.barlines.left || null, right: sa.barlines.right || tb?.barlines.right || "regular" },
    fifths: sa.fifths,
    notes,
  };
}

function groupChordStems(notes) {
  const groups = new Map();
  for (const note of notes) {
    if (!note.chordId || note.isRest) continue;
    if (!groups.has(note.chordId)) groups.set(note.chordId, []);
    groups.get(note.chordId).push(note);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const up = stemUp(group[0]);
    const extreme = group.reduce((best, note) => {
      if (best.step == null) return note;
      if (note.step == null) return best;
      return (up ? note.step > best.step : note.step < best.step) ? note : best;
    });
    const mixed = group.some((note) => note.small) && group.some((note) => !note.small && !note.unison);
    const host = mixed ? group.find((note) => !note.small && !note.unison) || extreme : extreme;
    for (const note of group) {
      if (note === host) continue;
      note.stemless = true;
      note.beams = [];
    }
  }
}

function placeUnisonBadges(notes) {
  const groups = new Map();
  for (const note of notes) {
    if (note.isRest || !note.chordId) continue;
    if (!groups.has(note.chordId)) groups.set(note.chordId, []);
    groups.get(note.chordId).push(note);
  }
  for (const group of groups.values()) {
    const unisons = group.filter((note) => note.unison);
    if (!unisons.length) continue;
    const host = group.find((note) => !note.unison && note.parts?.includes("S")) || group.find((note) => !note.unison);
    if (!host) continue;
    unisons.forEach((note, index) => {
      note.x = host.x + 18;
      note.y = host.y - 18 - index * 16;
      note.badge = true;
    });
  }
}

function drawMusic(width, measures, notes, state, tops = [SA_TOP, TB_TOP], height = HEIGHT) {
  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);
  for (const measure of measures) {
    if (measure.index === state.playMeasure) {
      parts.push(`<rect x="${measure.x}" y="18" width="${measure.w}" height="${height - 28}" fill="#e8f0fe"/>`);
    }
    if (
      state.scope === "bars" &&
      measure.index >= (state.selectionStart ?? -1) &&
      measure.index <= (state.selectionEnd ?? -1)
    ) {
      parts.push(
        `<rect x="${measure.x + 1}" y="20" width="${Math.max(0, measure.w - 4)}" height="${height - 32}" fill="none" stroke="#2457d6" stroke-width="2" rx="4"/>`,
      );
    }
  }
  for (const top of tops) {
    for (let i = 0; i < 5; i++) {
      const y = top + i * LG;
      parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#222" stroke-width="1"/>`);
    }
  }
  for (const measure of measures) {
    parts.push(`<text x="${measure.x + 2}" y="16" font-size="11" fill="#667085" font-family="sans-serif">${esc(measure.number)}</text>`);
    for (const harmony of measure.harmonies) {
      parts.push(
        `<text x="${harmony.x}" y="30" text-anchor="middle" font-size="15" font-weight="700" fill="#1f2933" font-family="sans-serif">${esc(harmony.text)}</text>`,
      );
    }
    drawBar(parts, measure.x + 1, measure.barlines.left, tops);
    drawBar(parts, measure.x + measure.w - 2, measure.barlines.right, tops);
  }
  drawTies(parts, notes);
  drawBeams(parts, notes, state);
  for (const note of notes) drawNote(parts, note, state);
  const cursorX = measures.find((measure) => measure.index === state.playMeasure)?.x ?? 0;
  const cursorBottom = tops[tops.length - 1] + STAFF_H + 10;
  parts.push(
    `<line id="cursor" x1="${cursorX}" y1="${tops[0] - 10}" x2="${cursorX}" y2="${cursorBottom}" stroke="#d61f2c" stroke-width="2" visibility="hidden"/>`,
  );
  return `<svg id="music" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

function drawGutter(width, sa, tb) {
  const parts = [`<rect width="${width}" height="${HEIGHT}" fill="#fff"/>`];
  for (const top of [SA_TOP, TB_TOP]) {
    for (let i = 0; i < 5; i++) {
      const y = top + i * LG;
      parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#222" stroke-width="1"/>`);
    }
  }
  parts.push(brace(SA_TOP, TB_TOP + STAFF_H));
  parts.push(`<text x="16" y="${SA_TOP - 8}" font-size="11" font-weight="700" fill="#667085" font-family="sans-serif">SA</text>`);
  parts.push(`<text x="16" y="${TB_TOP - 8}" font-size="11" font-weight="700" fill="#667085" font-family="sans-serif">TB</text>`);
  const clefX = 30;
  parts.push(trebleClef(clefX, yOn(SA_TOP, 2)));
  parts.push(bassClef(clefX + 6, yOn(TB_TOP, 6)));
  let keyX = clefX + 34;
  keyX = drawKey(parts, keyX, SA_TOP, "G", sa?.fifths ?? 0);
  drawKey(parts, clefX + 34, TB_TOP, "F", tb?.fifths ?? 0);
  const beats = sa?.beats ?? 4;
  const beatType = sa?.beatType ?? 4;
  parts.push(
    `<text x="${width - 16}" y="${SA_TOP + LG * 1.55}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${beats}</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="${SA_TOP + LG * 3.35}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${beatType}</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="${TB_TOP + LG * 1.55}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${beats}</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="${TB_TOP + LG * 3.35}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${tb?.beatType ?? beatType}</text>`,
  );
  parts.push(`<line x1="${width - 1}" y1="0" x2="${width - 1}" y2="${HEIGHT}" stroke="#e4e7eb"/>`);
  return `<svg id="gutter" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${parts.join("")}</svg>`;
}

function drawSingleGutter(width, staff, height, label) {
  const clef = staff?.clef?.sign === "F" ? "F" : "G";
  const parts = [`<rect width="${width}" height="${height}" fill="#fff"/>`];
  for (let i = 0; i < 5; i++) {
    const y = SA_TOP + i * LG;
    parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#222" stroke-width="1"/>`);
  }
  parts.push(`<text x="16" y="${SA_TOP - 8}" font-size="11" font-weight="700" fill="#667085" font-family="sans-serif">${esc(label)}</text>`);
  const clefX = 30;
  if (clef === "F") parts.push(bassClef(clefX + 6, yOn(SA_TOP, 6)));
  else parts.push(trebleClef(clefX, yOn(SA_TOP, 2)));
  drawKey(parts, clefX + 34, SA_TOP, clef, staff?.fifths ?? 0);
  const beats = staff?.beats ?? 4;
  const beatType = staff?.beatType ?? 4;
  parts.push(`<text x="${width - 16}" y="${SA_TOP + LG * 1.55}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${beats}</text>`);
  parts.push(`<text x="${width - 16}" y="${SA_TOP + LG * 3.35}" text-anchor="middle" font-size="16" font-weight="700" font-family="serif">${beatType}</text>`);
  parts.push(`<line x1="${width - 1}" y1="0" x2="${width - 1}" y2="${height}" stroke="#e4e7eb"/>`);
  return `<svg id="gutter" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

function brace(y1, y2) {
  const mid = (y1 + y2) / 2;
  return `<path d="M14 ${y1} C6 ${y1 + 16}, 6 ${mid - 10}, 2 ${mid} C6 ${mid + 10}, 6 ${y2 - 16}, 14 ${y2}" fill="none" stroke="#222" stroke-width="1.4"/>`;
}

function trebleClef(x, gY) {
  // Baseline sits a little below the G line so the clef's curl lands on it.
  return `<text x="${x - 6}" y="${gY + 16}" font-family="VocalClef, serif" font-size="46">𝄞</text>`;
}

function bassClef(x, fY) {
  return `<text x="${x - 16}" y="${fY + 14}" font-family="VocalClef, serif" font-size="46">𝄢</text>`;
}

function drawKey(parts, x, staffTop, clef, fifths) {
  const steps = fifths >= 0 ? SHARP_STEPS[clef] : FLAT_STEPS[clef];
  const n = keyCount(fifths);
  for (let i = 0; i < n; i++) {
    const y = yOn(staffTop, steps[i]);
    if (fifths >= 0) parts.push(sharpGlyph(x + i * 11, y));
    else parts.push(flatGlyph(x + i * 11, y));
  }
  return x + n * 11;
}

function sharpGlyph(x, y) {
  return `<g stroke="#111" stroke-width="1.2" fill="none">
    <line x1="${x - 3}" y1="${y - 11}" x2="${x - 3}" y2="${y + 11}"/>
    <line x1="${x + 2.4}" y1="${y - 11}" x2="${x + 2.4}" y2="${y + 11}"/>
    <line x1="${x - 5.2}" y1="${y - 2}" x2="${x + 4.6}" y2="${y - 5}" stroke-width="1.7"/>
    <line x1="${x - 5.2}" y1="${y + 5}" x2="${x + 4.6}" y2="${y + 2}" stroke-width="1.7"/>
  </g>`;
}

function flatGlyph(x, y) {
  return `<path d="M ${x} ${y - 14} L ${x} ${y + 5} M ${x} ${y - 1} C ${x + 7} ${y - 4}, ${x + 7} ${y + 7}, ${x} ${y + 4}" fill="none" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function drawBar(parts, x, kind, tops = [SA_TOP, TB_TOP]) {
  if (!kind) return;
  const y1 = tops[0];
  const y2 = tops[tops.length - 1] + STAFF_H;
  const line = (xx, width) => `<line x1="${xx}" y1="${y1}" x2="${xx}" y2="${y2}" stroke="#222" stroke-width="${width}"/>`;
  if (kind === "regular") parts.push(line(x, 1));
  else if (kind === "double") {
    parts.push(line(x - 4, 1));
    parts.push(line(x, 1));
  } else if (kind === "final") {
    parts.push(line(x - 6, 1));
    parts.push(line(x, 3.5));
  } else if (kind === "repeat-backward") {
    parts.push(dots(x - 10, tops));
    parts.push(line(x - 4, 1));
    parts.push(line(x, 3.5));
  } else if (kind === "repeat-forward" || kind === "heavy-light") {
    parts.push(line(x, 3.5));
    parts.push(line(x + 4, 1));
    parts.push(dots(x + 12, tops));
  }
}

function dots(x, tops = [SA_TOP, TB_TOP]) {
  const spots = tops.flatMap((top) => [top + LG * 1.5, top + LG * 2.5]);
  return spots.map((y) => `<circle cx="${x}" cy="${y}" r="1.7" fill="#222"/>`).join("");
}

function partColor(note, state) {
  const part = note.parts?.includes(state.activePart) ? state.activePart : note.parts?.[0];
  return PART_COLORS[part] || "#111";
}

const BADGE_NAME = { A: "High", T: "Low", B: "Bass", S: "Melody" };

function drawNote(parts, note, state) {
  const selected = note.id === state.selectedId;
  const color = note.isRest ? "#111" : partColor(note, state);
  if (state.showChanges && note.edited && !note.badge) {
    parts.push(`<circle cx="${note.x}" cy="${note.y}" r="12" fill="none" stroke="#e0a100" stroke-width="2.5"/>`);
  }
  if (selected && !note.isRest) {
    parts.push(`<circle cx="${note.x}" cy="${note.y}" r="10" fill="none" stroke="#111" stroke-width="1.8"/>`);
  }
  if (note.ambiguous && !note.badge) {
    parts.push(`<circle cx="${note.x}" cy="${note.y}" r="11" fill="none" stroke="#b45309" stroke-width="1.4" stroke-dasharray="3 2"/>`);
    if (note.stackLower && !note.partCover) {
      parts.push(`<text x="${note.x + 12}" y="${note.y - 8}" font-size="12" font-weight="700" fill="#b45309" font-family="sans-serif">?</text>`);
    }
  }
  if (note.badge) {
    const name = BADGE_NAME[note.parts?.[0]] || "unison";
    const label = `${name} unison`;
    const width = Math.max(54, label.length * 6.4);
    parts.push(
      `<rect x="${note.x - 4}" y="${note.y - 11}" width="${width}" height="16" rx="4" fill="#fff" stroke="${color}" stroke-width="1.4"/>`,
    );
    parts.push(
      `<text x="${note.x}" y="${note.y + 1}" font-size="11" font-weight="700" fill="${color}" font-family="sans-serif">${esc(label)}</text>`,
    );
    return;
  }
  if (note.isRest) {
    parts.push(restGlyph(note, color));
    return;
  }
  if (note.step != null && (note.step <= -2 || note.step >= 10)) {
    const from = note.step <= -2 ? -2 : 10;
    const to = note.step <= -2 ? note.step : note.step;
    const dir = note.step <= -2 ? -2 : 2;
    for (let s = from; dir < 0 ? s >= to : s <= to; s += dir) {
      if (s % 2) continue;
      const y = yOn(note.staffTop, s);
      parts.push(`<line x1="${note.x - 11}" y1="${y}" x2="${note.x + 11}" y2="${y}" stroke="#222" stroke-width="1"/>`);
    }
  }
  const up = stemUp(note);
  const beamed = note.beams.some((b) => b.number === 1);
  if (note.type !== "whole" && !note.stemless) {
    const x = note.x + (up ? 5.4 : -5.4);
    const y2 = note.y + (up ? -1 : 1) * (beamed ? LG * 3.5 : note.type === "half" ? LG * 3.1 : LG * 3.5);
    if (!beamed) parts.push(`<line x1="${x}" y1="${note.y}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="1.3"/>`);
    if (!beamed && (note.type === "eighth" || note.type === "16th" || note.type === "32nd")) {
      parts.push(flag(x, y2, up, note.type, color));
    }
  }
  const open = note.type === "whole" || note.type === "half";
  const scale = note.small ? 0.72 : 1;
  const rx = (note.type === "whole" ? 7.2 : 5.8) * scale;
  const ry = 4.15 * scale;
  parts.push(
    `<ellipse cx="${note.x}" cy="${note.y}" rx="${rx}" ry="${ry}" transform="rotate(-18 ${note.x} ${note.y})" fill="${open ? "#fff" : color}" stroke="${color}" stroke-width="${open ? 1.7 : 1}" data-id="${esc(note.id)}" data-parts="${esc((note.parts || []).join(""))}" data-pitch="${esc(note.pitchLabel || "")}" data-bar="${esc(note.measureNumber || "")}"/>`,
  );
  for (let i = 0; i < note.dots; i++) {
    const dy = note.step != null && note.step % 2 === 0 ? -STEP : 0;
    parts.push(`<circle cx="${note.x + 12 + i * 6}" cy="${note.y + dy}" r="1.8" fill="${color}"/>`);
  }
  if (note.lyric) {
    let text = note.lyric.text;
    if ((note.lyric.syllabic === "begin" || note.lyric.syllabic === "middle") && !text.endsWith("-")) text += "-";
    const y = note.staffTop === SA_TOP ? SA_TOP + STAFF_H + 20 : TB_TOP + STAFF_H + 20;
    parts.push(
      `<text x="${note.x}" y="${y}" text-anchor="middle" font-size="13" fill="#1f2933" font-family="sans-serif">${esc(text)}</text>`,
    );
  }
}

function stemUp(note) {
  if (note.stem === "down") return false;
  if (note.stem === "up") return true;
  return note.voice !== "2";
}

function flag(x, y, up, type, color) {
  const dir = up ? 1 : -1;
  const n = type === "16th" || type === "32nd" ? 2 : 1;
  let out = "";
  for (let i = 0; i < n; i++) {
    const yy = y + dir * i * 7;
    out += `<path d="M ${x} ${yy} C ${x + 10} ${yy + dir * 6}, ${x + 12} ${yy + dir * 16}, ${x + 2} ${yy + dir * 18}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  }
  return out;
}

function restGlyph(note, color) {
  const x = note.x;
  const top = note.staffTop;
  if (note.type === "whole" || note.measureRest || note.type === "breve") {
    return `<rect x="${x - 7}" y="${top + LG}" width="14" height="5" fill="${color}"/>`;
  }
  if (note.type === "half") return `<rect x="${x - 7}" y="${top + LG * 2 - 5}" width="14" height="5" fill="${color}"/>`;
  if (note.type === "eighth") {
    return `<g fill="${color}" stroke="${color}">
      <path d="M ${x - 4} ${top + 10} C ${x + 8} ${top + 16}, ${x + 2} ${top + 30}, ${x - 2} ${top + 26}" fill="none" stroke-width="1.6"/>
      <circle cx="${x + 1}" cy="${top + 30}" r="3.2" stroke="none"/>
    </g>`;
  }
  if (note.type === "16th") {
    return `<g fill="${color}" stroke="${color}">
      <path d="M ${x - 4} ${top + 6} C ${x + 8} ${top + 12}, ${x + 2} ${top + 24}, ${x - 2} ${top + 20}" fill="none" stroke-width="1.5"/>
      <circle cx="${x + 1}" cy="${top + 22}" r="2.8" stroke="none"/>
      <circle cx="${x + 5}" cy="${top + 32}" r="2.8" stroke="none"/>
    </g>`;
  }
  return `<path d="M ${x} ${top + 8} L ${x + 7} ${top + 16} L ${x - 3} ${top + 22} L ${x + 7} ${top + 30} L ${x - 2} ${top + 38}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function drawBeams(parts, notes, state) {
  const byMeasure = new Map();
  for (const note of notes) {
    if (note.isRest) continue;
    const key = `${note.measureIndex}|${note.staffTop}|${note.voice}`;
    if (!byMeasure.has(key)) byMeasure.set(key, []);
    byMeasure.get(key).push(note);
  }
  for (const groupNotes of byMeasure.values()) {
    groupNotes.sort((a, b) => a.startQl - b.startQl);
    let current = null;
    const groups = [];
    for (const note of groupNotes) {
      const beam = note.beams.find((b) => b.number === 1);
      if (!beam) {
        current = null;
        continue;
      }
      if (beam.type === "begin" || !current) {
        current = [note];
        groups.push(current);
      } else {
        current.push(note);
        if (beam.type === "end") current = null;
      }
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      paintBeam(parts, group, partColor(group[0], state));
    }
  }
}

function paintBeam(parts, group, color) {
  const up = stemUp(group[0]);
  const dir = up ? -1 : 1;
  const len = LG * 3.45;
  const xOf = (note) => note.x + (up ? 5.4 : -5.4);
  const x0 = xOf(group[0]);
  const x1 = xOf(group[group.length - 1]);
  let y0 = group[0].y + dir * len;
  let y1 = group[group.length - 1].y + dir * len;
  const span = x1 - x0 || 1;
  for (const note of group) {
    const t = (xOf(note) - x0) / span;
    const yLine = y0 + (y1 - y0) * t;
    const need = note.y + dir * len;
    if (dir < 0 && yLine > need) {
      y0 -= yLine - need;
      y1 -= yLine - need;
    } else if (dir > 0 && yLine < need) {
      y0 += need - yLine;
      y1 += need - yLine;
    }
  }
  const yAt = (x, level) => {
    const t = (x - x0) / span;
    return y0 + (y1 - y0) * t + dir * -1 * level * (LG * 0.72);
  };
  for (const note of group) {
    const x = xOf(note);
    parts.push(`<line x1="${x}" y1="${note.y}" x2="${x}" y2="${yAt(x, 0)}" stroke="${color}" stroke-width="1.3"/>`);
  }
  parts.push(
    `<line x1="${x0}" y1="${yAt(x0, 0)}" x2="${x1}" y2="${yAt(x1, 0)}" stroke="${color}" stroke-width="${LG * 0.48}" stroke-linecap="butt"/>`,
  );
  const maxLevel = Math.max(...group.flatMap((n) => n.beams.map((b) => b.number)));
  for (let level = 2; level <= maxLevel; level++) {
    for (let i = 0; i < group.length; i++) {
      const beam = group[i].beams.find((b) => b.number === level);
      if (!beam) continue;
      const x = xOf(group[i]);
      if (beam.type === "forward hook" || (beam.type === "begin" && (i === group.length - 1 || !group[i + 1].beams.some((b) => b.number === level)))) {
        const x2 = x + Math.min(12, span * 0.45);
        parts.push(partial(x, yAt(x, level - 1), x2, yAt(x2, level - 1), color));
      } else if (beam.type === "backward hook") {
        const x2 = x - Math.min(12, span * 0.45);
        parts.push(partial(x2, yAt(x2, level - 1), x, yAt(x, level - 1), color));
      } else if (beam.type === "begin" || beam.type === "continue") {
        const next = group[i + 1];
        if (!next || !next.beams.some((b) => b.number === level && (b.type === "continue" || b.type === "end"))) continue;
        const x2 = xOf(next);
        parts.push(partial(x, yAt(x, level - 1), x2, yAt(x2, level - 1), color));
      }
    }
  }
}

function partial(x1, y1, x2, y2, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${LG * 0.42}" stroke-linecap="butt"/>`;
}

function drawTies(parts, notes) {
  const pending = new Map();
  const ordered = notes.slice().sort((a, b) => a.absQl - b.absQl || a.x - b.x);
  for (const note of ordered) {
    if (note.isRest) continue;
    const key = `${note.staffTop}|${note.voice}|${note.parts.join("")}`;
    if (note.tieStop && pending.has(key)) {
      const from = pending.get(key);
      const up = stemUp(from);
      const y1 = from.y + (up ? 8 : -8);
      const y2 = note.y + (up ? 8 : -8);
      const mid = (from.x + note.x) / 2;
      const bow = (y1 + y2) / 2 + (up ? 12 : -12);
      parts.push(`<path d="M ${from.x + 8} ${y1} Q ${mid} ${bow} ${note.x - 8} ${y2}" fill="none" stroke="#222" stroke-width="1.3"/>`);
      if (!note.tieStart) pending.delete(key);
      else pending.set(key, note);
    } else if (note.tieStart) pending.set(key, note);
  }
}

export function xForQl(layout, ql) {
  const measure = layout.measures.find((m) => ql >= m.startQl && ql < m.endQl - 1e-6) || layout.measures[layout.measures.length - 1];
  if (!measure) return 0;
  return measure.xAt(ql - measure.startQl);
}

export function locateQl(layout, ql) {
  const x = xForQl(layout, ql);
  const measure = layout.measures.find((item) => ql >= item.startQl && ql < item.endQl - 1e-6) || layout.measures[layout.measures.length - 1];
  const system = layout.systems?.[measure?.systemIndex];
  if (!system) return { x, localX: x, systemIndex: 0, y1: 0, y2: 0 };
  return { x, localX: x - system.start, systemIndex: system.index, y1: system.y1, y2: system.y2 };
}
