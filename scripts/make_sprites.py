#!/usr/bin/env python3
"""Join the source samples of each instrument into one MP3 and write the region table.

Reads assets/samples/<instrument>/*.mp3 (piano, bass, guitar, drums), decodes each
file to 44.1 kHz stereo, joins them in sorted file order with 0.1 s of silence before
each one and after the last, and encodes public/samples/<instrument>/<instrument>.mp3
with libmp3lame (-q:a 5, drums -q:a 4: the cymbals need it). Also writes
src/audio/sprites.json, which the site bundles:

  { "<instrument>": { "file": "...", "regions": { "<name>": [start, end] } },
    "drums": { ..., "kit": <assets/samples/drums/kit.json with region names> } }

Region names are note names for the tonal instruments (Ds3 is "D#3") and file
stems ("kick-v1-r1") for the drums. Times are seconds. The output is the same on
every run.

  python3 scripts/make_sprites.py

Needs ffmpeg and numpy.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "samples"
OUT = ROOT / "public" / "samples"
TABLE = ROOT / "src" / "audio" / "sprites.json"

RATE = 44100
GAP = 0.1  # seconds of silence before each sample and after the last
INSTRUMENTS = {"piano": "5", "bass": "5", "guitar": "5", "drums": "4"}  # LAME -q:a
FLAT_TO_SHARP = {"Ds": "D#", "Fs": "F#", "Bb": "A#", "Db": "C#"}


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)


def region_name(instrument: str, stem: str) -> str:
    if instrument == "drums":
        return stem
    m = re.fullmatch(r"([A-G][sb]?)(\d)", stem)
    if not m:
        sys.exit(f"unexpected sample name: {stem}")
    return FLAT_TO_SHARP.get(m.group(1), m.group(1)) + m.group(2)


def encode(pcm: np.ndarray, quality: str, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "-",
         "-c:a", "libmp3lame", "-q:a", quality, "-fflags", "+bitexact", "-flags:a", "+bitexact", str(dst)],
        input=pcm.tobytes(), check=True,
    )


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is needed: brew install ffmpeg")
    table = {}
    gap = np.zeros((round(GAP * RATE), 2), np.float32)
    for instrument, quality in INSTRUMENTS.items():
        files = sorted((SRC / instrument).glob("*.mp3"), key=lambda p: p.name)
        if not files:
            sys.exit(f"no samples in {SRC / instrument}")
        parts, regions, pos = [], {}, 0
        for f in files:
            pcm = decode(f)
            parts += [gap, pcm]
            pos += len(gap)
            regions[region_name(instrument, f.stem)] = [round(pos / RATE, 6), round((pos + len(pcm)) / RATE, 6)]
            pos += len(pcm)
        parts.append(gap)
        out = OUT / instrument / f"{instrument}.mp3"
        encode(np.concatenate(parts), quality, out)
        table[instrument] = {"file": f"{instrument}/{instrument}.mp3", "regions": regions}
        print(f"{instrument}: {len(files)} samples, {out.stat().st_size} bytes")

    kit = json.loads((SRC / "drums" / "kit.json").read_text())
    table["drums"]["kit"] = {
        sound: [[Path(name).stem for name in takes] for takes in layers] for sound, layers in kit.items()
    }
    TABLE.write_text(json.dumps(table, indent=1) + "\n")
    print("wrote", TABLE.relative_to(ROOT))


if __name__ == "__main__":
    main()
