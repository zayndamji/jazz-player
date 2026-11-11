# Jazz Teacher

A website for practicing jazz tunes. It shows the chord chart, or the lead sheet with the melody, and plays a backing band (bass, guitar, piano, drums) that follows the chords. Tunes so far: "Example Tune" (bossa nova) and "Second Tune" (medium swing).

## What it does

- Library: every tune in a list you can search by title and filter by style. Each tune has its own address (`#/tune/<id>`).
- Chord chart view: four bars per line, rehearsal letters, bar numbers, repeat bars, double barlines at section ends. The bar that's playing is highlighted.
- Lead sheet view: the melody in notation with the chords above it, drawn in the same colours and font as the chart, with the same highlight. Same band, same controls.
- Bossa nova band: upright bass on 1 and 3 with anticipations, nylon guitar comping that varies between figures and pushes chord changes, soft held piano chords, and a sampled acoustic jazz kit with fills at section ends, a crash where a section starts and the ride in the bridge.
- Medium swing band: walking bass with half-step approaches, swung piano comping, quiet four-to-the-bar guitar, ride cymbal with the hi-hat on 2 and 4, snare comping and fills.
- Ballad band: bass in half notes that starts walking in the bridge and later choruses, rolled piano chords held through each change with soft triplet fills, and brushes (a sweep on 1 and 3, a stroke on 2 and 4) made from shaped noise, since the drum samples have no brushes.
- Player bar at the bottom: play and stop (or the space bar), a progress line you can click to jump, tempo from 60 to 240 BPM, Loop, Metronome, Mute (remembered between visits; the band keeps playing silently), and More.
- Click any bar, in either view, to play from there.
- Loop: repeats the section that's playing (or the last one clicked). Clicking a rehearsal letter loops that section.
- Every tune is stored in its original concert key. Two separate settings in More change it:
  - Band plays in: moves the whole tune, sound and music, to any of the 12 keys, shown as half steps up or down from the original.
  - Written for: prints the chart and lead sheet for a concert, B♭, E♭ or F instrument without changing the sound. A trumpet player picks B♭ and sees Example Tune in D while the band plays in C. The site remembers this choice between tunes and visits.
- More also has the number of choruses or until stopped, a two-bar count-in, scale names under each chord, and a mixer with volume and mute for each part.
- While playing, the player bar shows the bar, chorus, and a scale for the current chord with its notes.
- Light theme only, like printed music. Works on phones.

## How it works

- A chart is one JSON file in `src/charts/`: key, tempo, style, and sections of bars written as chord symbols. The site collects every file in that folder; tests check each one.
- The timeline lays it out in playing order: count-in, intro, choruses, tag, final bar. Looping plays the section or form twice and repeats the second copy, so playback can start on any bar.
- A style turns the timeline into notes, and can set its own mix. Each style is modelled on a measured reference recording (`scripts/analyze_reference.py`).
- Piano and guitar use rootless drop-2 voicings, each chord voice-led from the last.
- The player schedules everything on the Tone.js clock in beats, so tempo and key changes apply while playing.
- The lead sheet is a MusicXML file rendered by OpenSheetMusicDisplay, transposed with the chart.
- Everything runs in the browser. There is no server.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord parsing and transposing, scales, transposing instruments |
| `src/charts/` | The tunes as JSON, the chart checks, and the loader for local lead sheets |
| `src/engine/` | Timeline, voicings, playback schedule |
| `src/styles/` | Backing styles (bossa nova, medium swing, ballad) |
| `src/audio/player.ts` | Tone.js playback, sampled and synthesized instruments, mixer |
| `src/pages/` | The library and the tune page |
| `src/components/` | Chord chart, lead sheet, player bar, mixer |
| `public/samples/` | Piano, bass, guitar and drum samples, each folder with its license |
| `scripts/` | Repeatable jobs: fetching samples, turning typed heads into MusicXML, measuring reference recordings and the site's mix |
| `local/heads/` | Your lead sheets as MusicXML (not in git) |

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

```bash
python3 scripts/fetch_drum_samples.py
```

Downloads and converts the drum kit into `public/samples/drums/` (needs ffmpeg). The samples are already committed; run it only to change the kit.

```bash
python3 scripts/analyze_reference.py TRACK.m4a --form 32
```

Measures a reference recording: tempo, swing, rhythm per frequency band, band balance, loudness per form bar (needs ffmpeg and numpy).

`scripts/mix-meter.js` is the matching check for the site: start playback on the dev server, paste it into the browser console, and it returns the same band balance for what the site plays. It listens before Mute, so it works muted.

## Adding a tune, a lead sheet or a style

- Tune: add `src/charts/<id>.json` with the `Chart` shape from `src/chart/types.ts` (copy an existing one). Bars are strings like `"Em7/A A7"` (chords split the bar evenly) or `"%"` (same chord). Write the chords in concert pitch. `npm test` checks every chord and the style name.
- Lead sheet: type the melody as `local/heads/<chart id>.head.txt` and run `python3 scripts/make_head.py local/heads/<chart id>.head.txt`, or save `local/heads/<chart id>.musicxml` from MuseScore. The text format (in the script's help) reads notes against the key signature like a printed part, and `transpose: -M2` turns a B♭ part into concert pitch. The Lead sheet view appears when the MusicXML is there. Lead sheets stay out of git because melodies are copyrighted; a build made on your machine includes yours.
- Style: add a file in `src/styles/` that implements `Style` from `src/styles/types.ts`, and list it in `src/styles/index.ts`. Balance its `mix` against a reference recording.

## Tools and licenses

- [Tone.js](https://github.com/Tonejs/Tone.js), MIT: audio clock, sampler, synthesized drums
- [tonal](https://github.com/tonaljs/tonal), MIT: chord and scale theory
- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay), BSD-3-Clause: lead sheet rendering (uses VexFlow, MIT)
- [React](https://github.com/facebook/react), MIT: interface
- [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest), MIT: dev server, build, tests
- [TypeScript](https://github.com/microsoft/TypeScript), Apache-2.0: type checking
- [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC BY 3.0: piano samples
- Fluid R3 GM SoundFont by Frank Wen, MIT: bass and nylon guitar samples, via [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)
- [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios and Karoryfer Samples, CC0: drum samples
