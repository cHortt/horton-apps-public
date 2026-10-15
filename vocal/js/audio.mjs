// In-browser piano. Partials plus a short hammer noise, no samples and no network.
import { midiToFreq } from "./theory.mjs";

export function createEngine() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 6;
  limiter.ratio.value = 3.5;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;
  limiter.connect(ctx.destination);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const live = new Set();

  function play(midi, when, dur, gain) {
    const freq = midiToFreq(midi);
    const master = ctx.createGain();
    const peak = Math.max(0.0001, gain);
    master.gain.setValueAtTime(0.0001, when);
    master.gain.exponentialRampToValueAtTime(peak, when + 0.008);
    master.gain.exponentialRampToValueAtTime(peak * 0.45, when + 0.09);
    const releaseAt = when + Math.max(0.18, dur);
    master.gain.exponentialRampToValueAtTime(0.0001, releaseAt + 0.35);
    master.connect(limiter);

    const partials = [1, 2, 3, 4, 5, 6];
    const amps = [1, 0.52, 0.28, 0.16, 0.08, 0.04];
    for (let i = 0; i < partials.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const n = partials[i];
      osc.frequency.setValueAtTime(freq * n * (1 + 0.00015 * n * n), when);
      const g = ctx.createGain();
      const amp = amps[i] * (midi > 72 ? 0.8 : 1);
      g.gain.setValueAtTime(amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4 + (6 - n) * 0.28);
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(releaseAt + 0.4);
      live.add(osc);
      osc.onended = () => live.delete(osc);
    }

    const hit = ctx.createBufferSource();
    hit.buffer = noise;
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

  return {
    ctx,
    play,
    async resume() {
      if (ctx.state !== "running") await ctx.resume();
    },
    stopAll() {
      const now = ctx.currentTime;
      for (const node of live) {
        try {
          node.stop(now);
        } catch {
          /* already stopped */
        }
      }
      live.clear();
    },
  };
}

export function startTransport({ engine, events, fromQl, endQl, quarterBpm, getMix, onFrame, onEnd }) {
  const sec = 60 / quarterBpm;
  const t0 = engine.ctx.currentTime + 0.06;
  let index = 0;
  while (index < events.length && events[index].ql + events[index].durQl <= fromQl) index++;
  let stopped = false;
  let timer = 0;

  const finish = (natural) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (!natural) engine.stopAll();
    onEnd();
  };

  const tick = () => {
    if (stopped) return;
    const now = engine.ctx.currentTime;
    const horizon = now + 0.4;
    const mix = getMix();
    while (index < events.length) {
      const event = events[index];
      const startQl = Math.max(event.ql, fromQl);
      const when = t0 + (startQl - fromQl) * sec;
      if (when > horizon) break;
      index++;
      const gain = mix.mutes[event.channel] ? 0 : mix.gains[event.channel] || 0;
      if (gain < 0.001) continue;
      const dur = (event.ql + event.durQl - startQl) * sec;
      engine.play(event.midi, when, Math.max(0.06, dur), gain * 0.2);
    }
    const ql = fromQl + Math.max(0, now - t0) / sec;
    onFrame(ql);
    if (ql >= endQl - 0.02) finish(true);
  };

  tick();
  if (!stopped) timer = setInterval(tick, 70);
  return { stop: () => finish(false) };
}
