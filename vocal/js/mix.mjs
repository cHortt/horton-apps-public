import { dbToGain } from "./theory.mjs";

// Playback levels for the Mix panel. null is Off and mutes that channel.
// The fader is 1 dB steps from DB_MIN to DB_MAX. Slider 0 is Off.
// Order matches the part tabs: Soprano, Alto, Tenor, Bass, then Piano.
export const CHANNELS = ["S", "A", "T", "B", "P"];
export const DB_MIN = -24;
export const DB_MAX = 6;
export const SLIDER_MAX = DB_MAX - DB_MIN + 1;
// v1 stored S as the melody and A as the upper harmony. Those codes now mean
// Soprano and Alto, so a saved melody level is moved onto A before it is read.
const STORAGE_KEY = "vocal-mix-levels-v2";
const LEGACY_KEY = "vocal-mix-levels";

export function defaultLevels() {
  return { S: 0, A: 0, T: 0, B: 0, P: -6 };
}

export function clampLevel(db) {
  if (db == null || db === "") return null;
  const n = Math.round(Number(db));
  if (!Number.isFinite(n)) return null;
  return Math.max(DB_MIN, Math.min(DB_MAX, n));
}

export function normalizeLevels(input) {
  const base = defaultLevels();
  const out = {};
  for (const channel of CHANNELS) {
    if (!input || typeof input !== "object" || !(channel in input)) out[channel] = base[channel];
    else out[channel] = input[channel] == null ? null : clampLevel(input[channel]);
  }
  return out;
}

export function sliderToDb(position) {
  const n = Math.round(Number(position));
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampLevel(DB_MIN + n - 1);
}

export function dbToSlider(db) {
  if (db == null || !Number.isFinite(Number(db))) return 0;
  return clampLevel(db) - DB_MIN + 1;
}

export function formatLevel(db) {
  if (db == null) return "Off";
  const n = Math.round(db);
  return n > 0 ? `+${n} dB` : `${n} dB`;
}

export function setLevel(levels, channel, db) {
  const next = normalizeLevels(levels);
  if (CHANNELS.includes(channel)) next[channel] = db == null ? null : clampLevel(db);
  return next;
}

export function playbackMix(levels) {
  const spec = normalizeLevels(levels);
  const gains = {};
  const mutes = {};
  for (const channel of CHANNELS) {
    const db = spec[channel];
    if (db == null) {
      gains[channel] = 0;
      mutes[channel] = true;
    } else {
      gains[channel] = dbToGain(db);
      mutes[channel] = false;
    }
  }
  return { gains, mutes, levels: spec };
}

export function channelLabel(names, channel) {
  return names[channel];
}

// Vocal parts on the open score. Bass is included only when the file has one.
// Piano is always a playback channel. No score shows the same parts as the tabs.
export function channelsForScore(score) {
  if (!score) return ["S", "A", "T", "P"];
  const parts = score.parts || [];
  const hasTb = parts.some((part) => part.role === "TB");
  const hasUpper = parts.some((part) => part.role === "SA" || part.role === "extra");
  const present = new Set();
  if (hasUpper || !hasTb) present.add("S").add("A").add("T");
  else present.add("T");
  if (hasTb) present.add("B");
  for (const part of parts) {
    for (const measure of part.measures || []) {
      for (const note of measure.notes || []) {
        if (note.parts?.includes?.("B")) present.add("B");
      }
    }
  }
  present.add("P");
  return CHANNELS.filter((channel) => present.has(channel));
}

function readStored(storage, key) {
  const raw = storage?.getItem?.(key);
  if (raw == null || raw === "") return null;
  return JSON.parse(raw);
}

// The first release of the sliders saved the melody on S and the upper
// harmony on A. S is now Soprano and A is Alto, so those two levels swap
// once. Tenor, Bass, and Piano kept their codes.
export function migrateLegacyLevels(input) {
  const levels = normalizeLevels(input);
  const melody = levels.S;
  const upper = levels.A;
  levels.S = upper;
  levels.A = melody;
  return levels;
}

export function loadLevels(storage) {
  try {
    const current = readStored(storage, STORAGE_KEY);
    if (current) return normalizeLevels(current);
    const legacy = readStored(storage, LEGACY_KEY);
    if (!legacy) return defaultLevels();
    const migrated = migrateLegacyLevels(legacy);
    try {
      storage?.setItem?.(STORAGE_KEY, JSON.stringify(migrated));
    } catch {
      /* storage can be unavailable */
    }
    return migrated;
  } catch {
    return defaultLevels();
  }
}

export function saveLevels(storage, levels) {
  const normalized = normalizeLevels(levels);
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* storage can be unavailable */
  }
  return normalized;
}

export function createMix(storage) {
  let levels = loadLevels(storage);
  const commit = () => playbackMix(saveLevels(storage, levels));
  return {
    levels() {
      return { ...levels };
    },
    playback() {
      return playbackMix(levels);
    },
    set(channel, db) {
      levels = setLevel(levels, channel, db);
      return commit();
    },
    reset() {
      levels = defaultLevels();
      return commit();
    },
    // Part tabs choose which notes are edited. Opening a file does not
    // replace the levels the sliders are holding.
    selectPart() {
      return playbackMix(levels);
    },
    openFile() {
      return playbackMix(levels);
    },
  };
}
