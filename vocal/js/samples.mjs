// Sampled piano for the accompaniment. License and source: ../SAMPLES.md

export const PIANO_GAIN = 0.2039;

export const PIANO = {
  label: "piano",
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
};

export function pianoVoice(midi) {
  let note = PIANO.notes[0];
  let best = Infinity;
  for (const candidate of PIANO.notes) {
    const distance = Math.abs(candidate.midi - midi);
    if (distance < best) {
      note = candidate;
      best = distance;
    }
  }
  return { note, rate: 2 ** ((midi - note.midi) / 12) };
}
