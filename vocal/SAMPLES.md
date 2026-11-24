# Playback samples

Melody, High, and Low use the built-in plucky tone. The piano is a sampled instrument. A mix downloads it the first time piano is needed, then the service worker keeps it on the device. Nothing from a score is uploaded.

| Instrument | Part | Files | About |
|---|---|---|---|
| Piano | Piano | 23 notes, 560 KB | Block chords play when no Piano Vocal file is open. |

## Piano

Salamander Grand Piano by Alexander Holm (a Yamaha C5). This uses velocity layer 10, every minor third from F#1 through C7.

- Source: https://github.com/sfzinstruments/SalamanderGrandPiano
- License: [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/)

Changes from the original recordings: leading silence trimmed, converted to mono, cut to about 3 seconds with a short fade, and encoded as 64 kbps MP3. No endorsement by Alexander Holm is implied.

MP3 is used because it plays in Safari on iPhone and iPad, including over a cellular connection. The install cache does not prefetch these files.
