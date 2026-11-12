# Jazz Player

A framework for practicing jazz tunes in the browser. You add your tunes as chord charts (and lead sheets, if you like); it shows the chart or the lead sheet and plays a backing band (bass, piano and drums, plus guitar in bossa nova) that follows the chords. Styles so far: bossa nova, swing (slow-medium to up-tempo, with an optional two-feel) and ballad. The repo holds the framework only: tunes are your own content, kept out of git, and one made-up example (a blues in F) ships with it.

## What it does

- Library: every tune in a list you can search by title and filter by style. Each tune has its own address (`#/tune/<id>`).
- Chord chart view: four bars per line, rehearsal letters, bar numbers, repeat bars, double barlines at section ends. The bar that's playing is highlighted.
- Head and solo choruses: a tune whose solo changes differ from the head plays the head in the first and last chorus and the solo changes in between; the chart marks those sections "head" and "solos".
- Lead sheet view: the melody in notation with the chords above it, drawn in the same colours and font as the chart, with the same highlight. Same band, same controls.
- Bossa nova band: upright bass on 1 and 3 with anticipations, light piano comping in front of a quiet nylon guitar (the two push chord changes together), and a light sampled kit: soft hi-hat eighths in two-bar figures, cross-stick clave, short fills, the ride in the bridge and through the peak chorus.
- Swing band: a piano trio. Walking bass with half-step approaches and the odd ghosted note; piano comping in rootless voicings on rhythms that change every bar (2 and 4, Charleston, pushes on the ands that anticipate the next chord); the ride in two-bar figures around a pattern picked per chorus (the head sometimes on closed hi-hat), the hi-hat on 2 and 4, snare comping in the piano's gaps, crashes and kick set-ups into sections, and fills at phrase, section and chorus ends picked from a set. The comping changes register, voicing size and note length with the chorus. A chart can add four-to-the-bar guitar. It follows the tempo: the swing straightens and the comping thins out as it gets faster, and fills move to eighth notes. A two-feel option plays the intro and first chorus with half-note bass and cross-stick on 4, then walks.
- Ballad band: bass in half notes that starts walking in the bridge and later choruses, rolled piano chords held through each change with soft triplet fills, and brushes (a sweep on 1 and 3, a stroke on 2 and 4) made from shaped noise, since the drum samples have no brushes.
- Player bar at the bottom: play and pause (or Space; pausing keeps your place, and Play counts you back in there; Home, 0 or "From the top" goes back to the start), a progress line you can click to jump, tempo from 40 to 320 BPM, Loop, Metronome, Mute (remembered between visits; the band keeps playing silently), and More.
- Tempo: click the BPM number to type a tempo; hold − or + to keep stepping. When the tempo isn't the chart's, the original tempo shows next to the control and puts it back.
- Click any bar, in either view, to play from there.
- Keyboard: Space plays and pauses, Home or 0 goes to the start, `-` and `=` change the tempo, L loops, C turns on the metronome, M mutes, V switches the view, and `?` lists every shortcut. The list has a switch to turn off the single-letter keys.
- Left and Right arrows move a bar back or on, Shift with them a whole section; while playing the band jumps there, while paused the place moves. With Loop on they stay inside the loop, and Shift moves the loop to the next or previous section.
- Loop: repeats the section that's playing (or the last one clicked). Clicking a rehearsal letter loops that section. To loop any run of bars, click the first bar, then Shift-click the last (on a touch screen, press and hold the last bar); the button then reads "Bars 9-12". Loop or Esc stops it.
- Every tune is stored in its original concert key. Two separate settings in More change it:
  - Band plays in: moves the whole tune, sound and music, to any of the 12 keys, shown as half steps up or down from the original.
  - Written for: prints the chart and lead sheet for a concert, B♭, E♭ or F instrument without changing the sound. A trumpet player picks B♭ and sees a tune in C printed in D while the band plays in C. The site remembers this choice between tunes and visits.
- Key each chorus: More can move the key up a fourth, or a half or whole step either way, on every chorus (chorus 2 of a fourths cycle is 5 half steps up, folded back into the written range). The chart, the lead sheet and the key in the title follow the chorus that's playing. Loops and "until stopped" stay in one key.
- Mixer: an S button next to M solos a part (only soloed parts sound; the metronome is never affected), and a "Band" menu sets the mutes: Full band, No piano, No bass, No drums, Bass and drums, Drums only. It reads "Custom" when the mutes match none of them.
- The mixer in More shows the parts that play. More also has the band's style (any tune can play in any style; the chart names its original, and a change applies while playing), a two-feel first chorus (swing), the number of choruses or until stopped, switches to leave out the intro or the ending (for tunes that have them), a count-in of none, one or two bars, scale names under each chord, "Speed up each pass" (+1 to +10 BPM every time a loop comes round, up to 320; stopping keeps the new tempo), a click on every beat, on 2 and 4, or on beat 1 only (the count-in always clicks every beat), and a mixer with volume and mute for each part.
- Each tune remembers its own settings in the browser (tempo, key, style, choruses, view, mixer and the rest of More). "Reset to original" at the bottom of the settings puts the chart's own back. Mute and the instrument you write for are shared by all tunes.
- While playing, the player bar shows the bar, chorus, and a scale for the current chord with its notes, then the next chord when it changes within two bars.
- Light theme only, like printed music. Works on phones.

## How it works

- A chart is one JSON file, `tunes/<id>/chart.json`: key, tempo, style, optionally `twoFeel` and `band` (the parts that play, when not the style's own: add guitar to a swing tune, or leave out piano for a trio), and sections of bars written as chord symbols. A form section with `"play": "head"` or `"play": "solos"` plays only in head or only in solo choruses. The site collects every tune in `tunes/` and the example in `examples/`; tests check each one.
- The timeline lays it out in playing order: count-in, intro, choruses, tag, final bar. Looping plays the section or form twice and repeats the second copy, so playback can start on any bar.
- A style turns the timeline into notes for a tempo and feel, names its band, and can set its own mix. Every part follows one shared shape: swing and bossa play a lighter head, build through the solo choruses to a peak and come back for the last chorus; the ballad lifts a little each chorus. Notes are placed off the grid as players place them: each part in its own pocket (bass a little ahead, piano behind), the band drifting by a few milliseconds, and the piano's top note louder with the chord's notes a few milliseconds apart. Tempo changes regenerate the notes in place once the presses settle. Each style is modelled on a measured reference recording (`scripts/analyze_reference.py`).
- Piano and guitar use rootless voicings, each chord voice-led from the last: open drop-2 shapes for bossa, close shapes with the 3rd or 7th at the bottom for swing.
- The player schedules everything on the Tone.js clock in beats, so tempo and key changes apply while playing.
- The lead sheet is a MusicXML file rendered by OpenSheetMusicDisplay, transposed with the chart.
- Everything runs in the browser. There is no server.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord parsing and transposing, scales, transposing instruments |
| `src/charts/` | The loader for charts and lead sheets, and the chart checks |
| `src/fixtures/` | Made-up charts the tests use |
| `src/engine/` | Timeline, voicings, playback schedule |
| `src/styles/` | Backing styles (bossa nova, swing, ballad) |
| `src/audio/player.ts` | Tone.js playback, sampled and synthesized instruments, mixer |
| `src/pages/` | The library and the tune page |
| `src/components/` | Chord chart, lead sheet, player bar, mixer |
| `public/samples/` | One MP3 per instrument (piano, bass, guitar, drums) plus its license; this is all the site loads |
| `assets/` | Source samples, one file per note or drum hit, and their licenses (not shipped) |
| `scripts/` | Repeatable jobs: fetching samples, turning typed heads into MusicXML, measuring reference recordings and the site's mix |
| `tunes/<id>/` | Your tunes, one folder each (not in git): `chart.json`, optionally `head.txt` and `head.musicxml`, and anything you keep about the tune (reference sheets, recordings, notes) |
| `examples/blues-in-f/` | A made-up example chart, so a fresh checkout has something to play |

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

Downloads and converts the drum kit into `assets/samples/drums/` (needs ffmpeg). The samples are already committed; run it only to change the kit, then run `make_sprites.py`.

```bash
python3 scripts/make_sprites.py
```

Rebuilds the per-instrument files in `public/samples/` and `src/audio/sprites.json` from `assets/samples/` (needs ffmpeg and numpy).

```bash
python3 scripts/analyze_reference.py TRACK.m4a --form 32
```

Measures a reference recording: tempo, swing, rhythm per frequency band, band balance, loudness per form bar, and per band how busy, how varied, how dynamic and how far left or right it is (needs ffmpeg and numpy).

```bash
python3 scripts/analyze_timeline.py TRACK --bpm 140 --bar1 3.06 --form 32 --json out.json
```

Follows a whole track bar by bar: how varied each part is, how far notes sit from the grid, how the swing, accents, comping register and dynamics change from chorus to chorus, and where fills and crashes fall in the form.

`scripts/record-site.js` records what the site plays into `tunes/<id>/analysis/` (dev server only; run it in the page while a tune plays), so the same analyzer measures our band and a reference side by side.

`scripts/mix-meter.js` is a quicker check for the site: start playback on the dev server, paste it into the browser console, and it returns the same band balance for what the site plays. It listens before Mute, so it works muted.

## Adding a tune, a lead sheet or a style

- Tune: add `tunes/<id>/chart.json` with the `Chart` shape from `src/chart/types.ts` (copy `examples/blues-in-f/chart.json`). The folder name is the tune's id. Bars are strings like `"Em7/A A7"` (chords split the bar evenly), `"Am7 / / Fmaj7"` (a `/` holds the chord for a beat, so Fmaj7 starts on beat 4) or `"%"` (same chord). Store every tune in its original concert key, never a transposed part's key: a B♭ part in D is a tune in C. Write minor keys with an `m` (`"key": "Em"`). `npm test` checks every chord and the style name.
- Lead sheet: type the melody as `tunes/<id>/head.txt` and run `python3 scripts/make_head.py tunes/<id>/head.txt`, or save `tunes/<id>/head.musicxml` from MuseScore. The text format (in the script's help) reads notes against the key signature like a printed part, `transpose: -M2` turns a B♭ part into concert pitch, and `&&` splits a bar into two voices. The Lead sheet view appears when the MusicXML is there.
- `tunes/` stays out of git: charts and melodies are content you add, and many are copyrighted. A build made on your machine includes your tunes.
- Style: add a file in `src/styles/` that implements `Style` from `src/styles/types.ts`, and list it in `src/styles/index.ts`. Balance its `mix` against a reference recording.

## Tools and licenses

- [Tone.js](https://github.com/Tonejs/Tone.js), MIT: audio clock, sampler, synthesized drums
- [tonal](https://github.com/tonaljs/tonal), MIT: chord and scale theory
- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay), BSD-3-Clause: lead sheet rendering (uses VexFlow, MIT)
- [React](https://github.com/facebook/react), MIT: interface
- [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest), MIT: dev server, build, tests
- [TypeScript](https://github.com/microsoft/TypeScript), Apache-2.0: type checking
- [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC BY 3.0: piano samples
- Fluid R3 GM SoundFont by Frank Wen, MIT: bass and nylon guitar samples, rendered to MP3 by Benjamin Gleitzman in [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (renderings CC BY 3.0)
- [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios and Karoryfer Samples, CC0: drum samples
- Brush sweep and stroke: synthesized in `src/audio/drumkit.ts`, no samples
