# Jazz Stand

Practice jazz tunes in the browser with a band that follows the chords.

Jazz Stand shows a tune as a chord chart or a lead sheet and plays a backing band (bass, piano and drums, plus guitar in bossa nova) generated from the changes, with a metronome. It runs entirely in the browser, works offline and installs as an app.

The repo is the framework only. Your tunes stay on your machine, out of git, and one made-up blues in F ships as an example.

## Features

- Six styles: bossa nova, swing (with an optional two-feel), Latin (Afro-Cuban, on a 2-3 clave), ballad, jazz waltz (3/4) and jazz in 5 (5/4). Any tune can play in any style that fits its meter, and a section can have its own, such as Latin A sections with a swing bridge.
- A band that plays like a live one: a lighter head, a build through the solos, fills at phrase ends, and no two choruses note for note the same.
- Chord chart and lead sheet views, with the bar that's playing highlighted. Click any bar to play from it.
- Loop a section or any run of bars, with an optional speed-up on each pass.
- Transpose the tune, or print it for a B♭, E♭ or F instrument while the band stays in concert pitch.
- Practice tools: trade fours or eights with the drums, play the melody with the band, hide the chords to learn a tune by heart, move the key every chorus.
- A mixer with mute, solo and presets such as "Bass and drums".
- Import MusicXML files and iReal Pro links.
- Settings are remembered per tune and can be shared as a link.
- Keyboard shortcuts, and a layout that works on phones and tablets.

## Quick start

Needs Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173, pick "Blues in F (example)" and press Space.

## Adding a tune

Each tune is a folder in `tunes/<id>/` (gitignored). The folder name is the tune's id. Copy the example to start:

```json
{
  "id": "blues-in-f",
  "title": "Blues in F (example)",
  "key": "F",
  "tempo": 120,
  "beatsPerBar": 4,
  "style": "swing",
  "intro": { "label": "Intro", "bars": ["Gm7 C7", "Gm7 C7"] },
  "form": [{ "label": "A", "bars": ["F7", "Bb7", "F7", "Cm7 F7", "Bb7", "Bdim7", "F7", "D7", "Gm7", "C7", "F7 D7", "Gm7 C7"] }],
  "ending": [{ "label": "End", "bars": ["F6"] }]
}
```

- Bars: chords split the bar evenly (`"Em7/A A7"`), a `/` holds the chord for a beat (`"Am7 / / Fmaj7"` changes on beat 4), and `"%"` repeats the last bar.
- Chord symbols take the usual spellings: `Bø7`, `C°7`, `C-^7`, `G7(b9,b13)`, `G7alt`, `D7sus2`.
- Sections: a section can name its own style, for tunes that change feel (`{ "label": "B", "style": "swing", "bars": [...] }` in a Latin tune), and `"break": true` stops the band for a solo break.
- Key: store every tune in its original concert key (a B♭ part in D is a tune in C). Write minor keys with an `m` (`"Em"`).
- Lead sheet: save `tunes/<id>/head.musicxml` from MuseScore, or type the melody as `head.txt` and run `python3 scripts/make_head.py tunes/<id>/head.txt` (the format is in the script's help).
- `npm test` checks every chart's chords and style. The full shape, with optional fields such as `twoFeel`, `band`, `comp` and `mix`, is `Chart` in [`src/chart/types.ts`](src/chart/types.ts).

You can also import a tune in the library: an uncompressed MusicXML file, or an `irealb://` link (a playlist adds every song). Imported tunes are kept in your browser.

## Using it

The player bar at the bottom has Play, the progress line, tempo, Loop, Metronome, Mute and More. More groups the rest:

| Group | Settings |
| --- | --- |
| Band | Style, groove (varied or straight), two-feel heads |
| Key | Transpose, instrument, key change each chorus |
| Form | Choruses (a number, until stopped, or live), count-in, intro and ending |
| Practice | Trading, melody, chords shown, speed up, metronome beats, scale names |
| Mix | Volume, mute and solo per part, presets |

Keyboard shortcuts (press `?` on a tune for the full list):

| Key | Action |
| --- | --- |
| Space | Play, or pause and keep the place |
| Home or 0 | Back to the start |
| Left, Right | A bar back or on (Shift: a section) |
| `-`, `=` | Slower, faster |
| L, C, M | Loop, metronome, mute |
| V | Chord chart or lead sheet |
| H | Hide or show the chords |
| Esc | Stop looping |

To loop any run of bars, click the first bar and Shift-click the last (on a touch screen, press and hold the last bar). Clicking a rehearsal letter loops that section.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | Unit tests, including a check of every chart |
| `npm run build` | Type-check and build the static site into `dist/`, with the offline service worker |

The scripts in `scripts/` rebuild the samples and measure recordings. The Python ones need ffmpeg and numpy.

| Script | What it does |
| --- | --- |
| `make_head.py` | Turns a typed head into MusicXML |
| `fetch_drum_samples.py` | Downloads the drum kit into `assets/samples/drums/` (already committed) |
| `make_sprites.py` | Rebuilds `public/samples/` and `src/audio/sprites.json` from `assets/samples/` |
| `analyze_reference.py` | Measures a recording: tempo, swing, band balance, loudness, busyness per part |
| `analyze_timeline.py` | Follows a recording bar by bar: variation, timing, dynamics and fills per chorus |
| `record-site.js` | Records what the site plays, for the analyzers (run in the page on the dev server) |
| `mix-meter.js` | Measures the site's band balance from the browser console |

To add a style, implement `Style` from `src/styles/types.ts` in a new file in `src/styles/`, list it in `src/styles/index.ts`, and balance its `mix` against a reference recording.

## How it works

- The timeline lays a chart out in playing order: count-in, intro, choruses, ending.
- A style turns the timeline into notes for the tempo and feel. Each style is modelled on a measured reference recording.
- The piano plays rootless voicings and the guitar real guitar grips over its thumb, each voice-led from the last and sharing the tensions the next chord asks for.
- The player schedules everything on the Tone.js clock in beats, so tempo, key and style changes apply while playing.
- The lead sheet is MusicXML rendered by OpenSheetMusicDisplay and transposed with the chart.
- There is no server. Everything, including the audio, runs in the browser.

## Project layout

| Path | What it is |
| --- | --- |
| `src/chart/` | Chart types, chord parsing, transposing, scales |
| `src/charts/` | Loading charts and lead sheets, and the chart checks |
| `src/import/` | MusicXML and iReal Pro importers |
| `src/engine/` | Timeline, voicings, playback schedule |
| `src/styles/` | The backing styles and their shared helpers |
| `src/audio/` | Tone.js playback, instruments, mixer |
| `src/pages/`, `src/components/` | The library, the tune page, chart, lead sheet and player bar |
| `src/pwa/` | The offline service worker |
| `src/fixtures/` | Made-up charts for the tests |
| `public/samples/` | One MP3 per instrument, the only audio the site loads |
| `assets/` | Source samples and their licenses (not shipped) |
| `scripts/` | Sample, head and measurement tools |
| `examples/` | The made-up example chart |
| `tunes/` | Your tunes (not in git) |

## Credits

- [Tone.js](https://github.com/Tonejs/Tone.js) (MIT): audio clock, sampler, synthesized drums
- [tonal](https://github.com/tonaljs/tonal) (MIT): chord and scale theory
- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) (BSD-3-Clause): lead sheet rendering, using VexFlow (MIT)
- [React](https://github.com/facebook/react) (MIT), [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest) (MIT), [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0)
- [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC BY 3.0): piano samples
- Fluid R3 GM SoundFont by Frank Wen (MIT): bass samples, rendered to MP3 by Benjamin Gleitzman in [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) (renderings CC BY 3.0)
- [FreePats Spanish Classical Guitar](https://github.com/freepats/spanish-classical-guitar) by roberto@zenvoid.org (CC0): nylon guitar samples
- [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios and Karoryfer Samples (CC0): drum samples
- Brushes are synthesized in `src/audio/drumkit.ts`
