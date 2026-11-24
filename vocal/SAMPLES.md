# Playback samples

The vocal editor plays sampled instruments instead of a single synthesizer tone. A mix downloads an instrument the first time it needs it, then the service worker keeps that file on the device. Nothing from a score is uploaded.

| Instrument | Part | Files | About |
|---|---|---|---|
| Flute | Melody | 4 notes, 185 KB | Lowest sample is C4. Melody notes below C4 play one octave higher. |
| Oboe | High | 4 notes, 186 KB | |
| Tenor sax | Low | 5 notes, 233 KB | Reaches G3. |
| Piano | Piano | 23 notes, 560 KB | |

The four instruments together are 1.14 MB. All Parts asks for every instrument. Melody, High, and Low skip the instruments they mute.

## Flute and oboe

VS Chamber Orchestra: Community Edition (VSCO 2 CE), recorded by Sam Gossner and Simon Dalzell. Samples cut by Elan Hickler / Soundemote.

- Source: https://github.com/sgossner/VSCO-2-CE
- Flute: `Woodwinds/Flute/susNV`, softer layer
- Oboe: `Woodwinds/Oboe/Vib`, softer layer
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

These notes were trimmed, given a short sustain loop, level-matched, and saved as mono 16-bit WAV at 44.1 kHz.

## Tenor saxophone

Versilian Community Sample Library, non-vibrato tenor saxophone played by Brett.

- Source: https://github.com/sgossner/VCSL
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

Same trim, loop, and WAV conversion as the flute and oboe.

## Piano

Salamander Grand Piano by Alexander Holm (a Yamaha C5). This uses velocity layer 10, every minor third from F#1 through C7.

- Source: https://github.com/sfzinstruments/SalamanderGrandPiano
- License: [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/)

Changes from the original recordings: leading silence trimmed, converted to mono, cut to about 3 seconds with a short fade, and encoded as 64 kbps MP3. No endorsement by Alexander Holm is implied.

WAV and MP3 are used because both play in Safari on iPhone and iPad, including over a cellular connection. The install cache does not prefetch these files.
