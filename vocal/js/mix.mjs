import { dbToGain } from "./theory.mjs";

export const CHANNELS = ["S", "A", "T", "B", "P"];

// Decibels relative to the matched voice level. null mutes that channel.
// The featured voice is 0 dB. High and Low tuck the melody 12 dB under that
// and leave the other voice silent. Piano is −6 dB in every mix. Low keeps
// melody and piano at the same absolute level as High.
export const MIXES = {
  all: { id: "all", label: "All Parts", S: 0, A: 0, T: 0, B: 0, P: -6 },
  melody: { id: "melody", label: "Melody", S: 0, A: null, T: null, B: null, P: -6 },
  high: { id: "high", label: "High", S: -12, A: 0, T: null, B: null, P: -6 },
  low: { id: "low", label: "Low", S: -12, A: null, T: 0, B: null, P: -6 },
};

export function mixState(id) {
  const spec = MIXES[id] || MIXES.all;
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
  return { id: spec.id, label: spec.label, gains, mutes };
}
