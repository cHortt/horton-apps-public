// Sampled flute, oboe, tenor sax, and piano. Each instrument is fetched
// the first time a mix needs it. Mix gains live on channel buses.
import { CHANNEL_INSTRUMENT, INSTRUMENTS, LEVEL, soundingMidi } from "./samples.mjs";

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

  const ready = new Map();
  const loading = new Map();
  const live = new Set();
  let outputReady = offline;

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

  function nearest(notes, midi) {
    let best = notes[0];
    let bestDistance = Infinity;
    for (const note of notes) {
      const distance = Math.abs(note.midi - midi);
      if (distance < bestDistance) {
        best = note;
        bestDistance = distance;
      }
    }
    return best;
  }

  function play(channel, midi, when, dur) {
    const id = CHANNEL_INSTRUMENT[channel];
    const inst = ready.get(id);
    if (!inst) return;
    const sounded = soundingMidi(inst.floor, midi);
    const sample = nearest(inst.notes, sounded);
    if (!sample?.buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.setValueAtTime(2 ** ((sounded - sample.midi) / 12), when);
    if (!inst.oneShot && sample.loopStart != null && sample.loopEnd != null) {
      const endFrame = Math.min(sample.loopEnd, sample.buffer.length - 1);
      const startFrame = Math.min(sample.loopStart, endFrame - 1);
      src.loop = true;
      src.loopStart = startFrame / sample.buffer.sampleRate;
      src.loopEnd = endFrame / sample.buffer.sampleRate;
    }
    const env = ctx.createGain();
    const peak = Math.max(0.0001, LEVEL[id] || 1);
    const attack = inst.oneShot ? 0.004 : 0.018;
    const release = inst.oneShot ? 0.08 : 0.14;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + attack);
    const releaseAt = when + Math.max(attack + 0.02, dur);
    env.gain.setValueAtTime(peak, releaseAt);
    env.gain.exponentialRampToValueAtTime(0.0001, releaseAt + release);
    src.connect(env);
    env.connect(buses[channel] || master);
    src.start(when);
    src.stop(releaseAt + release + 0.03);
    live.add(src);
    src.onended = () => live.delete(src);
  }

  async function loadInstrument(id) {
    if (ready.has(id)) return ready.get(id);
    if (loading.has(id)) return loading.get(id);
    const spec = INSTRUMENTS[id];
    const job = (async () => {
      const notes = [];
      for (const note of spec.notes) {
        const response = await fetch(note.url);
        if (!response.ok) throw new Error(`Could not load the ${spec.label} sound.`);
        const audio = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(audio.slice(0));
        notes.push({ ...note, buffer });
      }
      notes.sort((a, b) => a.midi - b.midi);
      const inst = { ...spec, notes };
      ready.set(id, inst);
      loading.delete(id);
      return inst;
    })();
    loading.set(id, job);
    try {
      return await job;
    } catch (error) {
      loading.delete(id);
      throw error;
    }
  }

  function idsFor(mix) {
    const ids = new Set();
    for (const channel of CHANNELS) {
      if (mix.mutes[channel] || !(mix.gains[channel] > 0)) continue;
      ids.add(CHANNEL_INSTRUMENT[channel]);
    }
    return [...ids];
  }

  return {
    ctx,
    play,
    loadInstrument,
    async loadMix(mix) {
      await Promise.all(idsFor(mix).map((id) => loadInstrument(id)));
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
