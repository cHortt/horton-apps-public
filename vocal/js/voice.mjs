// The plucky voice used before sampled woodwinds. One tone for every
// vocal part. Swap this file to audition a different voice later.
import { midiToFreq } from "./theory.mjs";

// Set so a soloed melody stem matches the piano stem at the 0 dB voice level.
export const VOICE_GAIN = 0.299;

const PARTIALS = [1, 2, 3, 4, 5, 6];
const AMPS = [1, 0.52, 0.28, 0.16, 0.08, 0.04];

export function partialFrequency(midi, n) {
  return midiToFreq(midi) * n * (1 + 0.00015 * n * n);
}

export function createHammer(ctx) {
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  return noise;
}

export function playVoice(ctx, { midi, when, dur, destination, live, hammer, gain = 1 }) {
  const master = ctx.createGain();
  const peak = Math.max(0.0001, gain * VOICE_GAIN);
  master.gain.setValueAtTime(0.0001, when);
  master.gain.exponentialRampToValueAtTime(peak, when + 0.008);
  master.gain.exponentialRampToValueAtTime(peak * 0.45, when + 0.09);
  const releaseAt = when + Math.max(0.18, dur);
  master.gain.exponentialRampToValueAtTime(0.0001, releaseAt + 0.35);
  master.connect(destination);

  for (let i = 0; i < PARTIALS.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const n = PARTIALS[i];
    osc.frequency.setValueAtTime(partialFrequency(midi, n), when);
    const g = ctx.createGain();
    const amp = AMPS[i] * (midi > 72 ? 0.8 : 1);
    g.gain.setValueAtTime(amp, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4 + (6 - n) * 0.28);
    osc.connect(g);
    g.connect(master);
    osc.start(when);
    osc.stop(releaseAt + 0.4);
    live.add(osc);
    osc.onended = () => live.delete(osc);
  }

  if (!hammer) return;
  const hit = ctx.createBufferSource();
  hit.buffer = hammer;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  const hg = ctx.createGain();
  hg.gain.value = peak * 0.35;
  hit.connect(hp);
  hp.connect(hg);
  hg.connect(master);
  hit.start(when);
  hit.stop(when + 0.04);
  live.add(hit);
  hit.onended = () => live.delete(hit);
}

// Steady partials, no hammer. The pitch test renders this and reads the fundamental.
export function renderVoiceTone(midi, sampleRate, seconds = 0.5) {
  const length = Math.floor(sampleRate * seconds);
  const out = new Float32Array(length);
  for (let i = 0; i < PARTIALS.length; i++) {
    const freq = partialFrequency(midi, PARTIALS[i]);
    const amp = AMPS[i] * (midi > 72 ? 0.8 : 1);
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let n = 0; n < length; n++) out[n] += amp * Math.sin(omega * n);
  }
  return out;
}
