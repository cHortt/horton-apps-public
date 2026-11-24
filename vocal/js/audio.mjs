// Voices use the plucky synth. Piano is a sampled instrument, fetched the
// first time a mix needs it. Mix gains live on the channel buses.
import { PIANO, PIANO_GAIN, pianoVoice } from "./samples.mjs";
import { createHammer, playVoice } from "./voice.mjs";

const CHANNELS = ["S", "A", "T", "B", "P"];

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function createEngine(context) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = context || new AudioCtx({ latencyHint: "interactive" });
  const offline = context != null;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  master.connect(limiter);
  if (offline) limiter.connect(ctx.destination);

  const buses = {};
  for (const channel of CHANNELS) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    buses[channel] = gain;
  }

  const live = new Set();
  let outputReady = offline;
  let hammer = null;
  let piano = null;
  let pianoJob = null;

  function attachOutput() {
    if (outputReady) return;
    outputReady = true;
    const session = typeof navigator !== "undefined" ? navigator.audioSession : null;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        /* Safari before audioSession */
      }
      limiter.connect(ctx.destination);
      return;
    }
    if (isIOS() && typeof Audio !== "undefined" && ctx.createMediaStreamDestination) {
      try {
        const dest = ctx.createMediaStreamDestination();
        limiter.connect(dest);
        const el = new Audio();
        el.srcObject = dest.stream;
        el.setAttribute("playsinline", "");
        const played = el.play?.();
        if (played?.catch) played.catch(() => {});
        return;
      } catch {
        /* use the context destination */
      }
    }
    limiter.connect(ctx.destination);
  }

  function playPiano(midi, when, dur) {
    if (!piano) return;
    const voice = pianoVoice(midi);
    const sample = piano.notes.find((note) => note.midi === voice.note.midi);
    if (!sample?.buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.setValueAtTime(voice.rate, when);
    const env = ctx.createGain();
    const peak = Math.max(0.0001, PIANO_GAIN);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + 0.004);
    const releaseAt = when + Math.max(0.06, dur);
    env.gain.setValueAtTime(peak, releaseAt);
    env.gain.exponentialRampToValueAtTime(0.0001, releaseAt + 0.08);
    src.connect(env);
    env.connect(buses.P);
    src.start(when);
    src.stop(releaseAt + 0.11);
    live.add(src);
    src.onended = () => live.delete(src);
  }

  function play(channel, midi, when, dur) {
    if (channel === "P") {
      playPiano(midi, when, dur);
      return;
    }
    if (!hammer) hammer = createHammer(ctx);
    playVoice(ctx, { midi, when, dur, destination: buses[channel], live, hammer });
  }

  function loadPiano() {
    if (piano) return Promise.resolve(piano);
    if (pianoJob) return pianoJob;
    pianoJob = (async () => {
      const notes = [];
      for (const note of PIANO.notes) {
        const response = await fetch(note.url);
        if (!response.ok) throw new Error("Could not load the piano sound.");
        const audio = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(audio.slice(0));
        notes.push({ ...note, buffer });
      }
      piano = { notes };
      pianoJob = null;
      return piano;
    })();
    return pianoJob.then(
      (loaded) => loaded,
      (error) => {
        pianoJob = null;
        throw error;
      },
    );
  }

  return {
    ctx,
    play,
    async loadMix(mix) {
      if (mix.mutes.P || !(mix.gains.P > 0)) return;
      await loadPiano();
    },
    async resume() {
      attachOutput();
      if (ctx.state !== "running") await ctx.resume();
    },
    setMix(mix) {
      const now = ctx.currentTime;
      for (const channel of CHANNELS) {
        const value = mix.mutes[channel] ? 0 : mix.gains[channel] || 0;
        const param = buses[channel].gain;
        param.cancelScheduledValues(now);
        if (offline) {
          param.setValueAtTime(value, now);
          continue;
        }
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(value, now + 0.02);
      }
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

export function startTransport({ engine, getEvents, fromQl, endQl, quarterBpm, getMix, onFrame, onEnd }) {
  const sec = 60 / quarterBpm;
  const t0 = engine.ctx.currentTime + 0.05;
  let nextQl = fromQl;
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
    const horizon = now + 0.35;
    const mix = getMix();
    engine.setMix(mix);
    const events = getEvents();
    for (const event of events) {
      if (event.ql + 1e-6 < nextQl) continue;
      if (event.ql + event.durQl <= fromQl) continue;
      const startQl = Math.max(event.ql, fromQl);
      const when = t0 + (startQl - fromQl) * sec;
      if (when > horizon) break;
      const gain = mix.mutes[event.channel] ? 0 : mix.gains[event.channel] || 0;
      if (gain >= 0.001) engine.play(event.channel, event.midi, when, Math.max(0.05, (event.ql + event.durQl - startQl) * sec));
    }
    nextQl = fromQl + Math.max(0, horizon - t0) / sec;
    const ql = fromQl + Math.max(0, now - t0) / sec;
    onFrame(ql);
    if (ql >= endQl - 0.02) finish(true);
  };

  tick();
  if (!stopped) timer = setInterval(tick, 70);
  return { stop: () => finish(false) };
}
