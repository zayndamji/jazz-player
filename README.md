# Jazz Teacher

A website that shows jazz chord charts and plays a backing track generated from the chords. Bass, piano and drums follow the chart, with a metronome, tempo and key you control. The first tune is "Example Tune".

## What it does

- Shows the chart as a chord grid, four bars per row, with section labels and the playing bar lit up.
- Plays a bossa nova backing track: sampled piano and bass, synthesized drums.
- Play and stop (also the space bar), tempo from 60 to 240 BPM while playing, count-in, number of choruses.
- Metronome on or off, and a mixer with volume and mute for bass, piano, drums and click.
- Transposes to any key, while playing too, with chord spelling to match the key.

## How it works

- A chart is plain data: sections of bars, written as chord symbols (`src/charts/example-tune.ts`).
- The timeline lays the chart out in playing order: count-in, intro, each chorus, ending.
- A style turns the timeline into notes. The bossa style writes the bass line, piano comping with voice-led rootless voicings, and the drum pattern.
- The player schedules the notes on the Tone.js clock in beats, so tempo changes apply right away.
- Everything runs in the browser. There is no server.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord symbol parsing, transposing |
| `src/charts/` | The tunes |
| `src/engine/` | Timeline, piano voicings, playback schedule |
| `src/styles/` | Backing styles (bossa nova) |
| `src/audio/player.ts` | Tone.js playback, instruments and mixer |
| `src/components/` | Chord grid, controls, credits |
| `public/samples/` | Piano and bass samples with their licenses |

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
- [tonal](https://github.com/tonaljs/tonal), MIT: chord symbol parsing
- [React](https://github.com/facebook/react), MIT: interface
- [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest), MIT: dev server, build, tests
- [TypeScript](https://github.com/microsoft/TypeScript), Apache-2.0: type checking
- [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC BY 3.0: piano samples
- Fluid R3 GM SoundFont by Frank Wen, MIT: bass samples, via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)
