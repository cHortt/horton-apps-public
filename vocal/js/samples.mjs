// Sampled instruments for rehearsal playback. Licenses and sources: ../SAMPLES.md
// Trim gains are linear multipliers applied after each sample was level-matched,
// so a mix gain of 1 is the shared voice loudness.

export const LEVEL = {
  flute: 0.778,
  oboe: 0.6202,
  sax: 0.743,
  piano: 0.2039,
};

export const INSTRUMENTS = {
  flute: {
    label: "flute",
    // The recorded notes start at C4. Lower melody notes play that C4
    // recording slower, at the written pitch, down through F3. The tone
    // stays a flute (strong fundamental, weak upper harmonics), only darker.
    floor: null,
    oneShot: false,
    trim: LEVEL.flute,
    notes: [
      { midi: 60, url: "samples/flute/60.wav", loopStart: 6174, loopEnd: 23848 },
      { midi: 64, url: "samples/flute/64.wav", loopStart: 6174, loopEnd: 23787 },
      { midi: 69, url: "samples/flute/69.wav", loopStart: 6174, loopEnd: 23814 },
      { midi: 72, url: "samples/flute/72.wav", loopStart: 5292, loopEnd: 22966 },
    ],
  },
  oboe: {
    label: "oboe",
    floor: null,
    oneShot: false,
    trim: LEVEL.oboe,
    notes: [
      { midi: 62, url: "samples/oboe/62.wav", loopStart: 6174, loopEnd: 23874 },
      { midi: 65, url: "samples/oboe/65.wav", loopStart: 6174, loopEnd: 23814 },
      { midi: 70, url: "samples/oboe/70.wav", loopStart: 6174, loopEnd: 23776 },
      { midi: 74, url: "samples/oboe/74.wav", loopStart: 6174, loopEnd: 23799 },
    ],
  },
  sax: {
    label: "tenor sax",
    floor: null,
    oneShot: false,
    trim: LEVEL.sax,
    notes: [
      { midi: 54, url: "samples/sax/54.wav", loopStart: 6174, loopEnd: 23719 },
      { midi: 58, url: "samples/sax/58.wav", loopStart: 6174, loopEnd: 23889 },
      { midi: 62, url: "samples/sax/62.wav", loopStart: 6174, loopEnd: 23874 },
      { midi: 66, url: "samples/sax/66.wav", loopStart: 6174, loopEnd: 23814 },
      { midi: 70, url: "samples/sax/70.wav", loopStart: 6174, loopEnd: 23776 },
    ],
  },
  piano: {
    label: "piano",
    floor: null,
    oneShot: true,
    trim: LEVEL.piano,
    notes: [
      { midi: 30, url: "samples/piano/30.mp3" },
      { midi: 33, url: "samples/piano/33.mp3" },
      { midi: 36, url: "samples/piano/36.mp3" },
      { midi: 39, url: "samples/piano/39.mp3" },
      { midi: 42, url: "samples/piano/42.mp3" },
      { midi: 45, url: "samples/piano/45.mp3" },
      { midi: 48, url: "samples/piano/48.mp3" },
      { midi: 51, url: "samples/piano/51.mp3" },
      { midi: 54, url: "samples/piano/54.mp3" },
      { midi: 57, url: "samples/piano/57.mp3" },
      { midi: 60, url: "samples/piano/60.mp3" },
      { midi: 63, url: "samples/piano/63.mp3" },
      { midi: 66, url: "samples/piano/66.mp3" },
      { midi: 69, url: "samples/piano/69.mp3" },
      { midi: 72, url: "samples/piano/72.mp3" },
      { midi: 75, url: "samples/piano/75.mp3" },
      { midi: 78, url: "samples/piano/78.mp3" },
      { midi: 81, url: "samples/piano/81.mp3" },
      { midi: 84, url: "samples/piano/84.mp3" },
      { midi: 87, url: "samples/piano/87.mp3" },
      { midi: 90, url: "samples/piano/90.mp3" },
      { midi: 93, url: "samples/piano/93.mp3" },
      { midi: 96, url: "samples/piano/96.mp3" },
    ],
  },
};

export const CHANNEL_INSTRUMENT = { S: "flute", A: "oboe", T: "sax", B: "sax", P: "piano" };

// A floor raises notes that the samples cannot cover. The flute has no floor:
// Melody is always the written pitch, including F3–B3 under the C4 sample.
export function soundingMidi(floor, midi) {
  if (floor == null || midi >= floor) return midi;
  let next = midi + 12;
  while (next < floor) next += 12;
  return next;
}

// Which recording plays this written pitch, and how fast. The engine and the
// pitch test both use this so a low melody note cannot be moved up an octave
// unless the instrument sets a floor.
export function selectVoice(instrument, midi) {
  const sounded = soundingMidi(instrument.floor, midi);
  let note = instrument.notes[0];
  let best = Infinity;
  for (const candidate of instrument.notes) {
    const distance = Math.abs(candidate.midi - sounded);
    if (distance < best) {
      note = candidate;
      best = distance;
    }
  }
  return { sounded, note, rate: 2 ** ((sounded - note.midi) / 12) };
}
