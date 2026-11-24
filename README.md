# Bandstand

A framework for practicing jazz tunes in the browser. You add your tunes as chord charts (and lead sheets, if you like); it shows the chart or the lead sheet and plays a backing band (bass, piano and drums, plus guitar in bossa nova) that follows the chords. Styles so far: bossa nova, swing (slow-medium to up-tempo, with an optional two-feel), ballad, jazz waltz and jazz in 5 (5/4). The repo holds the framework only: tunes are your own content, kept out of git, and one made-up example (a blues in F) ships with it.

## What it does

- Library: every tune in a list you can search by title, filter by style and sort A to Z or by when you opened them. The search and filter stay when you open a tune and come back. The count reads "4 of 11 tunes" when filtered, and tunes with a lead sheet say so. An address with an unknown tune shows the list with a note. Each tune has its own address (`#/tune/<id>`).
- Import: the library's Import button takes an uncompressed MusicXML file (choose or drop it) or a pasted iReal Pro link (`irealb://` or `irealbook://`; a playlist adds every song). It reads the title, key (a transposed part comes in at concert pitch), meter, tempo, sections, repeats and endings, and chords placed by beat, and maps iReal styles to ours. Imported tunes stay in your browser, show "Imported" in the list and can be removed there. Meters other than 3/4, 4/4 and 5/4, meter changes and zipped .mxl files are refused with a sentence saying why.
- Chord chart view: four bars per line, rehearsal letters, bar numbers counted from the form's first bar (the intro is unnumbered, here and in the lead sheet, the readout and loop labels), repeat bars, double barlines at section ends. The bar that's playing is highlighted, and in a two-chord bar so is the chord that's sounding.
- Head and solo choruses: a tune whose solo changes differ from the head plays the head in the first and last chorus and the solo changes in between; the chart marks those sections "head" and "solos".
- Lead sheet view: the melody in notation with the chords above it, drawn like the chart (same colours, font, chord symbols, section labels and highlight). Same band, same controls.
- Bossa nova band: upright bass on 1 and 3 with anticipations, a nylon guitar leading the comping with light piano under it (the two push chord changes together, mostly into a new phrase; the piano keeps a two-bar figure for each section and varies it a little, holding each chord until about the next, and swells or falls back with the phrase; the guitar keeps one figure through a section), and a light sampled kit: straight hi-hat eighths with the ands nearly as strong as the beats, in two-bar figures that change from bar to bar, cross-stick on 2 and 4, short fills, the ride in the bridge and through the peak chorus.
- Swing band: a piano trio. Walking bass with half-step approaches that always resolve, walking a long held chord as one line that climbs and comes back, a touch that changes from bar to bar (legato, short, leaning on 2 and 4), dead notes, triplet rakes and the odd skip; piano comping in rootless voicings on a two-bar groove kept for each section (the ands of 2 and 4, the Charleston, 2 and 4, beat 3 and others), played as written at the start of each phrase and varied by one small move now and then, most often a push into the next phrase; each chord rings until about the next one (short only where the figure means a stab), and an and before a chord change anticipates it; the ride in two-bar figures around a pattern picked per chorus (the head sometimes on closed hi-hat), with edge accents and, at the peak, a phrase now and then on the crash, the hi-hat on 2 and 4, snare comping that comes in spells and leans into each phrase end, crashes and kick set-ups into sections, and fills picked from a set: a short set-up at most phrase ends, a full fill at about half the section ends, and one at every chorus end. The waltz drums do the same. The comping changes groove, register and voicing size with the chorus, swells or falls back over each four-bar phrase, and over a modal vamp moves its voicing up and down the scale. A chart can add four-to-the-bar guitar. It follows the tempo: the swing straightens and the comping thins out as it gets faster, and fills move to eighth notes. A two-feel option plays the intro, the first chorus and the out-head with half-note bass and cross-stick on 4, and walks the solos.
- Jazz waltz band (3/4): in the head the bass plays a dotted half, 1 and 3, or a pickup into the next bar, and walks in the solos; over a long pedal (a vamp written with slash chords) it plays pedal figures that lean on the and of 3. The piano keeps a two-bar figure for each section on 1, the swung and of 1, 2 and 3, varied a little, with minor, major and sus chords in fourths (the modal sound of the 1960s records). The ride plays "1, 2 and 3", "1, 2, 3 and", triplet rolls and a two-against-three figure, the hi-hat 2 and 3, with triplet fills.
- Jazz in 5 band (5/4, felt 3+2): the bass plays an ostinato (the root on 1 held through 3, the second chord on 4 and 5), over the vamp and the bridge alike; over a vamp the piano keeps a two-bar figure on the and of 1, the and of 2, 3 and 5 for each section and changes it a little, and over changing bars it comps each chord the same way through a section. The ride plays every beat with swung skips after 2 and 4, the hi-hat 2 and 4, the kick 1. Two chords in a 5/4 bar split 3+2, and the 2-and-4 click becomes 1 and 4.
- Ballad band: bass in half notes (with a pickup into the next chord now and then) that starts walking in the bridge and later choruses, rolled piano chords held through each change with the top note sung out, soft re-attacks and triplet fills, the register and level breathing with the phrase, and brushes (a sweep on 1 and 3, a stroke on 2 and 4) made from shaped noise, since the drum samples have no brushes.
- Player bar at the bottom: play and pause (or Space; pausing keeps your place, and Play counts you back in there; Home, 0 or "From the top" goes back to the start), a progress line over the whole performance (intro, every chorus, ending) that you can click to jump to a bar in its chorus, or use as a slider with Left and Right (a bar), Page Up and Page Down (a section), Home and End, tempo from 40 to 320 BPM, Loop, Metronome, Mute (remembered between visits; the band keeps playing silently), and More.
- Tempo: click the BPM number to type a tempo; hold − or + to keep stepping. When the tempo isn't the chart's and the band is stopped, "Back to 140 BPM" (the chart's tempo) shows under the readout.
- Click any bar, in either view, to play from there.
- Keyboard: Space plays and pauses, Home or 0 goes to the start, `-` and `=` change the tempo, L loops, C turns on the metronome, M mutes, V switches the view, H hides or shows the chords, and `?` lists every shortcut. The list has a switch to turn off the single-letter keys.
- Space and the arrows also work while More is open, except when a menu, field or slider has focus. A tap outside More only closes it.
- Click a bar to play from it. While playing, a click (or the arrows, the progress line) moves the band there on the next beat, so the pulse never breaks; during the count-in it keeps counting and comes in on the new bar.
- Left and Right arrows move a bar back or on, Shift with them a whole section; while playing the band jumps there, while paused the place moves. With Loop on they stay inside the loop, and Shift moves the loop to the next or previous section.
- Loop: repeats the section that's playing (or the last one clicked). Clicking a rehearsal letter loops that section. To loop any run of bars, click the first bar, then Shift-click the last (on a touch screen, press and hold the last bar); the button then reads "Bars 9-12". Loop or Esc stops it. Turning a loop on or off while playing carries on from where the band is, without restarting the bar.
- Every tune is stored in its original concert key. Two separate settings in More change it:
  - Band plays in: moves the whole tune, sound and music, to any of the 12 keys, shown as half steps up or down from the original.
  - Written for: prints the chart and lead sheet for a concert, B♭, E♭ or F instrument without changing the sound. A trumpet player picks B♭ and sees a tune in C printed in D while the band plays in C. The site remembers this choice between tunes and visits.
- Key each chorus: More can move the key up a fourth, or a half or whole step either way, on every chorus (chorus 2 of a fourths cycle is 5 half steps up, folded back into the written range). The chart, the lead sheet and the key in the title follow the chorus that's playing. Loops and "until stopped" move the key too: each pass of a loop, and each chorus when repeating until stopped, goes up by the step.
- Mixer: a Volume slider for the whole site (remembered for all tunes), a Solo button next to Mute that solos a part (only soloed parts sound; the metronome is never affected), and a "Preset" menu that sets the mutes: Full band, No piano, No bass, No drums, Bass and drums, Drums only. It reads "Custom" when the mutes match none of them.
- More groups its settings under Band, Key, Form, Practice and Mix. Band: the style (any tune can play in any style; the chart names its original, and a change applies while playing), Groove and two-feel heads (swing). Form: the number of choruses or until stopped (changeable while playing; if you lower it the band finishes the chorus it's in; until stopped builds through chorus 2, then every pass plays a little differently), a count-in of none, one or two bars, and switches to leave out the intro or the ending (for tunes that have them). Practice: trading, melody, chords shown, "Speed up" (+1 to +10 BPM every time a loop comes round, up to 320; stopping keeps the new tempo), "Metronome plays" on every beat, on 2 and 4 (2 and 3 in a waltz), or on beat 1 only (the count-in always clicks every beat), and scale names under each chord. Mix: the mixer, showing the parts that play.
- Groove: "Variation" (the default) lets the band develop as a live band does, as described above; "Straight" keeps one groove every bar (swing: spang-a-lang, the Charleston, one bass touch; bossa: the first guitar, piano and hat figures; waltz: walking bass, piano on 2 and 3; ballad: rolled chords and brushes only), at one level, with only a short fill and a crash at the end of each chorus. It applies while playing.
- Live: "Live" in Choruses repeats the solo choruses until you press the play button (it shows a stop square); the band then finishes the chorus it's in, plays the ending (or a held tonic chord) and stops. A second press stops at once.
- Play the melody: "Melody" in More plays the tune's lead sheet with the band, in the head choruses or in every chorus, on its own mixer channel (a piano voice, centred, a little in front). It swings with the band, sits a little behind the beat, and the comping moves its voicings under it. It follows the key, and stays out of solo choruses, loops and the drums' turns. Only for tunes with a lead sheet.
- Trade with the drums: "Trade" in More makes the band play the first 4 (or 8) bars of each solo chorus for you and the drums take a solo for the next 4 (or 8), or in "Fours, band out" everyone stops but the metronome. Head choruses are never traded; the readout says whose bars they are.
- Hide the chords to learn a tune by heart: "Chords shown" in More (or H) hides the chord symbols after the first chorus or always, on the chart and the lead sheet, leaving the bars, numbers and rehearsal marks where they were.
- Share a setup: "Copy link" in More copies an address like `#/tune/<id>?bpm=120&key=-2&style=bossa&for=Bb&choruses=4`. Opening it sets those for that visit only (they don't overwrite what the tune remembers).
- Each tune remembers its own settings in the browser (tempo, key, style, choruses, view, mixer and the rest of More). "Reset to original" at the bottom of the settings puts the chart's own back. Mute, Volume and the instrument you write for ("Written for", marked "all tunes") are shared by all tunes.
- The end of a song: the band slows into the final chord (10% at ballad tempos, up to 14% at 200 BPM and above), holds the last chord of the final bar, lets it ring at least 4.5 seconds and fades out. A tune played without an ending closes on a held tonic chord.
- While playing, the player bar shows the bar and "Chorus 2 of 4" (always), and a scale for the current chord with its notes, then the next chord when it changes within two bars; when space is short the extras go first.
- Light theme only, like printed music. Works on phones and tablets: below 1120 px wide or on a touch screen the player bar wraps into rows (three on a phone), the controls are at least 44 px, the bar gets Prev and Next buttons, it keeps clear of the notch and home indicator, and the More panel sits just above the bar however tall it wraps. A "Skip to player" link is the first thing Tab reaches, and the chart is one Tab stop for its bars (plus the rehearsal letters): Up and Down move a line, Left and Right move the place as everywhere else. Smooth scrolling stops when the system asks for reduced motion.
- The screen stays awake while the band plays, where the browser supports it.
- Install it from the browser as an app (Add to Home Screen on phones). After the first visit it works offline: the built site and the four sample files are kept on the device, and a new version replaces them the next time it opens online.

## How it works

- A chart is one JSON file, `tunes/<id>/chart.json`: key, tempo, style, optionally `twoFeel`, `band` (the parts that play, when not the style's own: add guitar to a swing tune, or leave out piano for a trio) `comp` (how the piano comps: in swing `sparse`, which also lays out for whole phrases in the solos, `busy`, or `blues` for laid-back riffs with crushed notes; in bossa `sparse` lays out for most of the head and saves the cross-stick for the solos), `mix` (dB per part on top of the style's mix, in the chart's own style), `pedal` (a note the waltz bass holds under every chord) and `trade` (the trading the page starts with), and sections of bars written as chord symbols. A form section with `"play": "head"` or `"play": "solos"` plays only in head or only in solo choruses. The site collects every tune in `tunes/` and the example in `examples/`; tests check each one.
- Charts are in 4/4, 3/4 or 5/4 (`beatsPerBar`). In a 3/4 bar three chords get a beat each and two chords get two beats and one, as in a jazz waltz. A 3/4 count-in clicks "1 . . | 1 2 3". Each style lists the meters it plays, and the Style menu offers only the styles that fit the chart.
- The timeline lays it out in playing order: count-in, intro, choruses, tag, final bar (a held tonic bar when there's no ending). A loop lays out a first copy, where playback can start on any bar, and at least four repeating copies, each generated on its own, so it doesn't repeat note for note.
- A style turns the timeline into notes for a tempo and feel, names its band, and can set its own mix. Every part follows one shared shape: swing, bossa, the waltz and 5/4 play a lighter head (the drums about 4 dB down), build phrase by phrase through the solo choruses to a peak and come back for the last chorus; the ballad lifts a little each chorus. Notes are placed off the grid as players place them: each part in its own pocket (bass on the ride or a hair behind, piano behind), the band drifting by a few milliseconds, and the piano's top note louder with the chord's notes a few milliseconds apart. Tempo changes regenerate the notes in place once the presses settle. Each style is modelled on a measured reference recording (`scripts/analyze_reference.py`).
- Piano and guitar use rootless voicings, each chord voice-led from the last: open drop-2 shapes for bossa, close shapes with the 3rd or 7th at the bottom for swing. Each voicing knows the next chord (a dominant into minor takes the flat 9 and flat 13) and stays a minor third above the bass.
- The player schedules everything on the Tone.js clock in beats, so tempo and key changes apply while playing. The sounds load when a tune opens, so Play starts at once.
- The lead sheet is a MusicXML file rendered by OpenSheetMusicDisplay, transposed with the chart.
- Everything runs in the browser. There is no server.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord parsing and transposing, scales, transposing instruments |
| `src/charts/` | The loader for charts and lead sheets, and the chart checks |
| `src/import/` | MusicXML and iReal Pro importers |
| `src/pwa/` | The offline service worker and the list of files it keeps |
| `src/fixtures/` | Made-up charts the tests use |
| `src/engine/` | Timeline, voicings, playback schedule |
| `src/styles/` | Backing styles (bossa nova, swing, ballad, jazz waltz, jazz in 5) and their shared helpers |
| `src/audio/player.ts` | Tone.js playback, sampled and synthesized instruments, mixer |
| `src/pages/` | The library and the tune page |
| `src/components/` | Chord chart, lead sheet, player bar, mixer |
| `public/samples/` | One MP3 per instrument (piano, bass, guitar, drums) plus its license; this is all the site loads |
| `public/icons/`, `public/manifest.webmanifest` | App icons and the manifest for installing the site |
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

Type-checks and builds the static site into `dist/`, with a service worker (`src/pwa/`) that keeps every built file and sample for offline use. The worker is only registered in a production build, never under `npm run dev`.

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

Follows a whole track bar by bar (add `--beats 3` for a waltz, to either analyzer): how varied each part is, how far notes sit from the grid, how the swing, accents, comping register and dynamics change from chorus to chorus, and where fills and crashes fall in the form.

`scripts/record-site.js` records what the site plays into `tunes/<id>/analysis/` (dev server only; run it in the page while a tune plays), so the same analyzer measures our band and a reference side by side.

`scripts/mix-meter.js` is a quicker check for the site: start playback on the dev server, paste it into the browser console, and it returns the same band balance for what the site plays. It listens before Mute, so it works muted.

## Adding a tune, a lead sheet or a style

- Tune: add `tunes/<id>/chart.json` with the `Chart` shape from `src/chart/types.ts` (copy `examples/blues-in-f/chart.json`). The folder name is the tune's id. Bars are strings like `"Em7/A A7"` (chords split the bar evenly), `"Am7 / / Fmaj7"` (a `/` holds the chord for a beat, so Fmaj7 starts on beat 4) or `"%"` (same chord). Store every tune in its original concert key, never a transposed part's key: a B♭ part in D is a tune in C. Write minor keys with an `m` (`"key": "Em"`). Chord symbols take the usual spellings (`Bø7`, `C°7`, `C-^7`, `G7(b9,b13)`, `G7alt`, `D7sus2`). `npm test` checks every chord and the style name.
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
