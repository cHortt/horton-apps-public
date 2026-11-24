import { eventsOn, linearVisits, playbackEvents, playbackTimeline } from "./musicxml.mjs";

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchClass(step, alter) {
  return (SEMI[step] + (alter || 0) + 120) % 12;
}

function intervalsOf(harmony) {
  const kind = String(harmony.kind || "").toLowerCase();
  let intervals;
  if (kind.includes("no3")) intervals = [0, 7];
  else if (kind === "2" || kind.includes("sus2") || kind === "suspended-second") intervals = [0, 2, 7];
  else if (kind.includes("sus") || kind === "suspended-fourth") intervals = [0, 5, 7];
  else if (kind === "m7" || kind === "minor-seventh") intervals = [0, 3, 7, 10];
  else if (kind === "ma9" || kind === "major-ninth") intervals = [0, 4, 7, 11, 14];
  else if (kind === "6" || kind === "major-sixth") intervals = [0, 4, 7, 9];
  else if (kind === "m" || kind === "minor") intervals = [0, 3, 7];
  else intervals = [0, 4, 7];
  for (const degree of harmony.degrees || []) {
    if (degree.type === "subtract" && degree.value === 3) {
      intervals = intervals.filter((interval) => interval % 12 !== 3 && interval % 12 !== 4);
    }
    if (degree.type === "subtract" && degree.value === 5) {
      intervals = intervals.filter((interval) => interval % 12 !== 7);
    }
  }
  return intervals;
}

// Close block chords: bass in octave 3, the rest stacked from octave 4.
export function blockChordMidis(harmony) {
  if (!harmony?.root?.step) return [];
  const rootPc = pitchClass(harmony.root.step, harmony.root.alter);
  const bassPc = harmony.bass?.step ? pitchClass(harmony.bass.step, harmony.bass.alter) : rootPc;
  const bass = 48 + bassPc;
  const root = 60 + rootPc;
  const upper = intervalsOf(harmony).map((interval) => root + interval);
  return [...new Set([bass, ...upper])].sort((a, b) => a - b);
}

export function chordEvents(score, timeline = playbackTimeline(score)) {
  const part = score.parts.find((item) => item.role !== "piano" && item.measures.some((measure) => measure.harmonies?.length));
  if (!part) return [];
  const symbols = [];
  for (const visit of timeline.visits) {
    const measure = part.measures[visit.index];
    if (!measure) continue;
    for (const harmony of measure.harmonies || []) {
      if (!harmony.root?.step) continue;
      symbols.push({ ql: visit.origin + harmony.ql, harmony });
    }
  }
  symbols.sort((a, b) => a.ql - b.ql);
  const compact = [];
  for (const symbol of symbols) {
    const last = compact[compact.length - 1];
    if (last && Math.abs(last.ql - symbol.ql) < 1e-4) compact[compact.length - 1] = symbol;
    else compact.push(symbol);
  }
  const events = [];
  for (let i = 0; i < compact.length; i++) {
    const next = i + 1 < compact.length ? compact[i + 1].ql : timeline.endQl;
    const durQl = Math.max(0.01, next - compact[i].ql);
    for (const midi of blockChordMidis(compact[i].harmony)) {
      events.push({ ql: compact[i].ql, durQl, midi, channel: "P", id: `chord:${i}:${midi}` });
    }
  }
  return events;
}

export function alignPianoEvents(vocalScore, pianoPart, timeline = playbackTimeline(vocalScore)) {
  const straight = linearVisits(pianoPart.measures);
  const events = eventsOn(pianoPart, "P", straight);
  const out = [];
  for (const event of events) {
    const span =
      straight.visits.find((visit) => event.ql >= visit.origin - 1e-6 && event.ql < visit.origin + visit.len - 1e-6) ||
      straight.visits[straight.visits.length - 1];
    if (!span) continue;
    const local = event.ql - span.origin;
    const number = String(span.measure.number);
    for (const visit of timeline.visits) {
      if (String(visit.measure.number) !== number) continue;
      out.push({ ...event, ql: visit.origin + local, channel: "P" });
    }
  }
  return out;
}

export function preparePlayback(score, pianoPart) {
  const timeline = playbackTimeline(score);
  const embedded = score.parts.some((part) => part.role === "piano");
  let events = playbackEvents(score);
  if (pianoPart) {
    events = events.filter((event) => event.channel !== "P");
    events.push(...alignPianoEvents(score, pianoPart, timeline));
  } else if (!embedded) {
    events.push(...chordEvents(score, timeline));
  }
  events.sort((a, b) => a.ql - b.ql || a.channel.localeCompare(b.channel) || a.midi - b.midi);
  return { events, visits: timeline.visits, endQl: timeline.endQl };
}
