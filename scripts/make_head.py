#!/usr/bin/env python3
"""Turn a head (melody) typed in a short text format into MusicXML for the site.

  python3 scripts/make_head.py tunes/<id>/head.txt
  # writes tunes/<id>/head.musicxml next to it

The text format, one directive or bar per line (a line starting with "#" is a comment):

  key: D           key signature of what you're typing, as a major key
  transpose: -M2   optional: interval to the output (-M2 turns a B-flat part into concert)
  per-line: 4      bars per printed line (default 4)
  @Intro [C/G] r/2 [Ab7(#5)/Gb] r/2     one bar: "@Label" starts a section,
  [Dmaj7] A4/1~                          "[Chord]" sits on the next note or rest

Notes are a letter and octave read against the key signature, like reading the
sheet: in D, "F5" means F-sharp. Add "!n", "!s", "!b" or "!x" for a natural, sharp,
flat or double sharp; it lasts to the end of the bar for that note, as in printed music. "r" is a
rest. Durations: 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, a "." after
any of them for dotted, and "t4" or "t8" for triplets. "~" ties into the next note.
Each bar must add up to 4/4. A bar in two voices puts "&&" between them: the
first voice (stems up, with the chord symbols) then the second (stems down),
each adding up to 4/4; accidentals carry within a voice only. Accidentals in the output are worked out again for
the output key, so transposed parts read correctly. Plain Python 3.
"""

import re
import sys
from pathlib import Path

DIV = 12  # divisions per quarter note: allows eighths, sixteenths and both triplets
DUR = {"1": (48, "whole"), "2": (24, "half"), "4": (12, "quarter"), "8": (6, "eighth"), "16": (3, "16th"),
       "t4": (8, "quarter"), "t8": (4, "eighth")}
STEPS = "CDEFGAB"
STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FIFTHS = {"Cb": -7, "Gb": -6, "Db": -5, "Ab": -4, "Eb": -3, "Bb": -2, "F": -1, "C": 0, "G": 1, "D": 2, "A": 3,
          "E": 4, "B": 5, "F#": 6, "C#": 7}
ORDER_SHARPS = "FCGDAEB"
INTERVALS = {"P1": (0, 0), "m2": (1, 1), "M2": (1, 2), "m3": (2, 3), "M3": (2, 4), "P4": (3, 5), "A4": (3, 6),
             "d5": (4, 6), "P5": (4, 7), "m6": (5, 8), "M6": (5, 9), "m7": (6, 10), "M7": (6, 11), "P8": (7, 12)}
# Chord quality as typed: (MusicXML kind, degrees as (value, alter, type))
KINDS = {
    "": ("major", []), "m": ("minor", []), "7": ("dominant", []), "m7": ("minor-seventh", []),
    "maj7": ("major-seventh", []), "6": ("major-sixth", []), "m6": ("minor-sixth", []), "9": ("dominant-ninth", []),
    "m9": ("minor-ninth", []), "maj9": ("major-ninth", []), "13": ("dominant-13th", []),
    "69": ("major-sixth", [(9, 0, "add")]), "6/9": ("major-sixth", [(9, 0, "add")]),
    "7(#5)": ("augmented-seventh", []), "7(b9)": ("dominant", [(9, -1, "add")]), "7(#9)": ("dominant", [(9, 1, "add")]),
    "7(#11)": ("dominant", [(11, 1, "add")]), "9(#11)": ("dominant-ninth", [(11, 1, "add")]),
    "m7b5": ("half-diminished", []), "dim7": ("diminished-seventh", []), "dim": ("diminished", []),
    "sus4": ("suspended-fourth", []), "7sus4": ("dominant", [(4, 0, "add"), (3, 0, "subtract")]),
    "7(b13)": ("dominant", [(13, -1, "add")]), "7(b9b13)": ("dominant", [(9, -1, "add"), (13, -1, "add")]),
    "7(#5#9)": ("augmented-seventh", [(9, 1, "add")]), "7(b5)": ("dominant", [(5, -1, "alter")]),
    "13(b9)": ("dominant-13th", [(9, -1, "alter")]), "maj7(#11)": ("major-seventh", [(11, 1, "add")]),
    "mMaj7": ("major-minor", []), "m(maj7)": ("major-minor", []), "m11": ("minor-11th", []),
}
# The same qualities typed without parentheses, as the charts write them ("G7b9").
KINDS.update({q.replace("(", "").replace(")", ""): v for q, v in list(KINDS.items()) if "(" in q})


def key_alters(key):
    """Alteration of each step in a major key's signature."""
    f = FIFTHS[key]
    alters = {s: 0 for s in STEPS}
    for s in (ORDER_SHARPS[:f] if f > 0 else ORDER_SHARPS[::-1][:-f]):
        alters[s] = 1 if f > 0 else -1
    return alters


def transpose_pitch(step, alter, octave, interval):
    """Move (step, alter, octave) by an interval given as (diatonic steps, semitones), either direction."""
    if not interval:
        return step, alter, octave
    steps, semis = interval
    i = STEPS.index(step) + steps
    new_step, new_octave = STEPS[i % 7], octave + i // 7
    old = octave * 12 + STEP_PC[step] + alter
    new_alter = old + semis - (new_octave * 12 + STEP_PC[new_step])
    return new_step, new_alter, new_octave


def parse_interval(text):
    m = re.fullmatch(r"([+-]?)([PMmAd]\d)", text.strip())
    if not m or m.group(2) not in INTERVALS:
        raise SystemExit(f"bad transpose interval {text!r}; use e.g. -M2 or +m3")
    steps, semis = INTERVALS[m.group(2)]
    return (-steps, -semis) if m.group(1) == "-" else (steps, semis)


def name_of(step, alter):
    return step + ("#" * alter if alter > 0 else "b" * -alter)


def harmony(symbol, interval):
    m = re.fullmatch(r"([A-G])([#b]?)(.*?)(?:/([A-G])([#b]?))?", symbol)
    if not m:
        raise SystemExit(f"can't read chord {symbol!r}")
    root, racc, quality, bass, bacc = m.groups()
    if quality not in KINDS:
        raise SystemExit(f"unknown chord quality {quality!r} in {symbol!r}; add it to KINDS")
    kind, degrees = KINDS[quality]
    acc = lambda a: {"#": 1, "b": -1}.get(a, 0)
    rs, ra, _ = transpose_pitch(root, acc(racc), 4, interval)
    out = f"<harmony><root><root-step>{rs}</root-step>" + (f"<root-alter>{ra}</root-alter>" if ra else "") + "</root>"
    out += f'<kind text="{quality}">{kind}</kind>'
    if bass:
        bs, ba, _ = transpose_pitch(bass, acc(bacc), 4, interval)
        out += f"<bass><bass-step>{bs}</bass-step>" + (f"<bass-alter>{ba}</bass-alter>" if ba else "") + "</bass>"
    for value, alter, typ in degrees:
        out += f"<degree><degree-value>{value}</degree-value><degree-alter>{alter}</degree-alter><degree-type>{typ}</degree-type></degree>"
    return out + "</harmony>"


def voice(text, num, v, stem, interval, in_alters, out_alters, tied):
    """One voice of a bar: MusicXML notes (and chord symbols) and its length in divisions.
    Accidentals last to the end of the bar within the voice; mark them again ("!s") in the
    other voice. `tied` carries each voice's open tie into the next bar."""
    notes, total, read, shown = [], 0, {}, {}
    group, filled = 0, 0  # open triplet bracket: its length and how much is filled, in divisions
    for tok in re.findall(r"\[[^\]]+\]|\S+", text):
        if tok.startswith("["):
            notes.append(harmony(tok[1:-1], interval))
            continue
        tie = tok.endswith("~")
        tok = tok.rstrip("~")
        m = re.fullmatch(r"(r|[A-G]\d)(?:!([nsbx]))?/(t4|t8|16|8|4|2|1)(\.?)", tok)
        if not m:
            raise SystemExit(f"bar {num}: can't read {tok!r}")
        pitch, mark, d, dot = m.groups()
        dur, typ = DUR[d]
        if dot:
            dur = dur * 3 // 2
        total += dur
        x = "<note>"
        if pitch == "r":
            x += "<rest/>"
        else:
            step, octave = pitch[0], int(pitch[1])
            if mark:
                read[(step, octave)] = {"n": 0, "s": 1, "b": -1, "x": 2}[mark]
            alter = read.get((step, octave), in_alters[step])
            ostep, oalter, ooct = transpose_pitch(step, alter, octave, interval)
            x += f"<pitch><step>{ostep}</step>" + (f"<alter>{oalter}</alter>" if oalter else "") + f"<octave>{ooct}</octave></pitch>"
        x += f"<duration>{dur}</duration>"
        if pitch != "r" and tied[v]:
            x += '<tie type="stop"/>'
        if tie and pitch != "r":
            x += '<tie type="start"/>'
        x += f"<voice>{v}</voice><type>{typ}</type>" + ("<dot/>" if dot else "")
        if pitch != "r":
            current = shown.get((ostep, ooct), out_alters[ostep])
            if oalter != current and not tied[v]:
                x += f"<accidental>{ {-2: 'flat-flat', -1: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'}[oalter] }</accidental>"
            shown[(ostep, ooct)] = oalter
        if stem and pitch != "r":
            x += f"<stem>{stem}</stem>"
        notations = []
        if d.startswith("t"):
            x += "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
            # A bracket holds three of its first note's value, so quarter and eighth triplets can mix.
            if not group:
                group, filled = 3 * dur, 0
                notations.append('<tuplet type="start" bracket="yes"/>')
            filled += dur
            if filled >= group:
                notations.append('<tuplet type="stop"/>')
                group = 0
        if pitch != "r" and tied[v]:
            notations.append('<tied type="stop"/>')
        if tie and pitch != "r":
            notations.append('<tied type="start"/>')
        if notations:
            x += "<notations>" + "".join(notations) + "</notations>"
        notes.append(x + "</note>")
        if pitch != "r":
            tied[v] = tie
    return notes, total


def build(src: Path) -> str:
    title = src.parent.name if src.name == "head.txt" else src.stem.replace(".head", "")
    key, interval, per_line, bars = "C", None, 4, []
    for raw in src.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"(key|transpose|per-line|title):\s*(.+)", line)
        if m:
            name, value = m.groups()
            if name == "key":
                key = value.strip()
            elif name == "transpose":
                interval = parse_interval(value)
            elif name == "per-line":
                per_line = int(value)
            else:
                title = value.strip()
            continue
        bars.append(line)

    in_alters = key_alters(key)
    out_key = name_of(*transpose_pitch(key[0], {"#": 1, "b": -1}.get(key[1:2], 0), 4, interval)[:2])
    if out_key not in FIFTHS:
        raise SystemExit(f"output key {out_key} has no simple signature; transpose another way")
    out_alters = key_alters(out_key)

    measures, tied = [], {1: False, 2: False}
    for num, text in enumerate(bars, 1):
        section = None
        if text.startswith("@"):
            section, _, text = text[1:].partition(" ")
        parts = [p.strip() for p in text.split("&&")]
        if len(parts) > 2:
            raise SystemExit(f"bar {num}: at most two voices")
        notes = []
        for v, part in enumerate(parts, 1):
            if v == 2:
                notes.append(f"<backup><duration>{4 * DIV}</duration></backup>")
            stem = ("up" if v == 1 else "down") if len(parts) == 2 else None
            xml, total = voice(part, num, v, stem, interval, in_alters, out_alters, tied)
            if total != 4 * DIV:
                raise SystemExit(f"bar {num} voice {v} adds up to {total / DIV} beats, not 4: {part}")
            notes += xml
        head = '<print new-system="yes"/>' if num > 1 and (num - 1) % per_line == 0 else ""
        if num == 1:
            head += (f"<attributes><divisions>{DIV}</divisions><key><fifths>{FIFTHS[out_key]}</fifths></key>"
                     "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>")
        if section:
            head += f'<direction placement="above"><direction-type><rehearsal>{section}</rehearsal></direction-type></direction>'
        next_section = num < len(bars) and bars[num].lstrip().startswith("@")
        tail = ""
        if num == len(bars):
            tail = '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
        elif next_section:
            tail = '<barline location="right"><bar-style>light-light</bar-style></barline>'
        measures.append(f'<measure number="{num}">{head}{"".join(notes)}{tail}</measure>')

    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
            '"http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0">'
            f"<work><work-title>{title}</work-title></work>"
            '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>'
            f'<part id="P1">{"".join(measures)}</part></score-partwise>\n')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    # tunes/<id>/head.txt becomes tunes/<id>/head.musicxml; <id>.head.txt becomes <id>.musicxml.
    out = src.with_name(src.name.replace(".txt", "") + ".musicxml" if src.name == "head.txt" else src.name.replace(".head.txt", "") + ".musicxml")
    out.write_text(build(src))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
