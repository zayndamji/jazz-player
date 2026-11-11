# Jazz Teacher

A website for practicing jazz tunes. It shows the chord chart and plays a backing band (bass, guitar, piano, drums) that follows the chords. The first tune is "Example Tune".

## What it does

- Chord chart view: four bars per line, rehearsal letters, bar numbers, repeat bars, double barlines at section ends. The bar that's playing is highlighted.
- Bossa nova band: upright bass on 1 and 3 with anticipations, nylon guitar comping, soft held piano chords, drums with fills at section ends and a soft crash where a section starts. Ends with a tag (the last four bars twice) and a final chord.
- Player bar at the bottom: play and stop (or the space bar), a progress line you can click to jump, tempo from 60 to 240 BPM, Loop, Metronome, and More.
- Click any bar to play from there.
- Loop: repeats the section that's playing (or the last one clicked). Clicking a rehearsal letter loops that section.
- More: key (all 12), instrument (concert, B♭, E♭, F parts), number of choruses or until stopped, a two-bar count-in, scale names under each chord, and a mixer with volume and mute for each part.
- While playing, the player bar shows the bar, chorus, and a scale for the current chord with its notes.
- Light and dark themes follow the system setting. Works on phones.

## How it works

- A chart is plain data: sections of bars written as chord symbols (`src/charts/example-tune.ts`).
- The timeline lays it out in playing order: count-in, intro, choruses, tag, final bar. Looping plays the section or form twice and repeats the second copy, so playback can start on any bar.
- A style turns the timeline into notes. The bossa style is modelled on a measured Band-in-a-Box bossa track.
- Piano and guitar use rootless drop-2 voicings, each chord voice-led from the last.
- The player schedules everything on the Tone.js clock in beats, so tempo and key changes apply while playing.
- Everything runs in the browser. There is no server.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord parsing and transposing, scales, transposing instruments |
| `src/charts/` | The tunes |
| `src/engine/` | Timeline, voicings, playback schedule |
| `src/styles/` | Backing styles (bossa nova) |
| `src/audio/player.ts` | Tone.js playback, sampled and synthesized instruments, mixer |
| `src/components/` | Chord chart, player bar, mixer |
| `public/samples/` | Piano, bass and guitar samples, each folder with its license |

## Run it

Needs Node.js 22.12 or newer.

```bash
npm install
```

```bash
npm run dev
```

Starts the dev server at http://localhost:5173.

```bash
npm test
```

Runs the unit tests.

```bash
npm run build
```

Type-checks and builds the static site into `dist/`.

## Adding a tune or a style

- Tune: add a file in `src/charts/` with the `Chart` shape from `src/chart/types.ts`. Bars are strings like `"Em7/A A7"` (chords split the bar evenly) or `"%"` (same chord).
- Style: add a file in `src/styles/` that implements `Style` from `src/styles/types.ts`, and list it in `src/styles/index.ts`.

## Tools and licenses

- [Tone.js](https://github.com/Tonejs/Tone.js), MIT: audio clock, sampler, synthesized drums
- [tonal](https://github.com/tonaljs/tonal), MIT: chord and scale theory
- [React](https://github.com/facebook/react), MIT: interface
- [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest), MIT: dev server, build, tests
- [TypeScript](https://github.com/microsoft/TypeScript), Apache-2.0: type checking
- [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC BY 3.0: piano samples
- Fluid R3 GM SoundFont by Frank Wen, MIT: bass and nylon guitar samples, via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)
