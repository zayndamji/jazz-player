#!/usr/bin/env python3
"""Fetch the drum kit used by the site from Virtuosity Drums (CC0) and convert it.

Downloads only the takes listed in KIT from github.com/sfzinstruments/virtuosity_drums,
trims each to a short one-shot, converts to MP3 with ffmpeg, and writes
public/samples/drums/kit.json, which the player reads.

  python3 scripts/fetch_drum_samples.py            # fetch and convert
  python3 scripts/fetch_drum_samples.py --dry-run  # list what it would fetch

Needs ffmpeg (and curl, or a Python with SSL certificates). Plain Python 3.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/Samples"
OUT = Path(__file__).resolve().parents[1] / "public" / "samples" / "drums"

# sound: (mic, folder, articulation, velocity layers soft to hard, round robins, seconds, mono)
KIT = {
    "kick": ("kickmic", "kick", "kick_snoff", [1, 2, 3, 4], [1, 2], 0.6, True),
    "rim": ("snaremic", "snare", "snare_crossstick", [4, 8, 12, 16], [None], 0.5, True),
    "snare": ("snaremic", "snare", "snare_center", [6, 14, 22, 30], [None], 0.7, True),
    "hat": ("oh", "hh", "hh_closed", [1, 2, 3, 4], [1, 2], 0.5, False),
    "pedal": ("oh", "hh", "hh_pedal", [1, 2, 3], [1], 0.6, False),
    "ride": ("oh", "ride", "ride_ride", [1, 2, 3], [1, 2], 2.5, False),
    "crash": ("oh", "crash", "crash_crash", [1, 2, 3], [1], 3.5, False),
    "tomHigh": ("oh", "htom", "htom_center", [6, 12], [None], 1.0, False),
    "tomLow": ("oh", "ltom", "ltom_center", [6, 12], [None], 1.2, False),
}

LICENSE = """# Drum samples

From Virtuosity Drums by Versilian Studios and Karoryfer Samples, played by
Austin McMahon, released under Creative Commons Zero (CC0 1.0):
https://github.com/sfzinstruments/virtuosity_drums

Trimmed and converted to MP3 by scripts/fetch_drum_samples.py. kit.json lists
each sound's files from soft to hard, with round robins.
"""


def source_name(mic, art, layer, rr):
    return f"{mic}_{art}_vl{layer}" + (f"_rr{rr}" if rr else "") + ".flac"


def download(url: str, dst: Path):
    # curl uses the system certificates; some Python installs ship without any.
    if shutil.which("curl"):
        subprocess.run(["curl", "-sSfL", "-o", str(dst), url], check=True)
    else:
        urllib.request.urlretrieve(url, dst)


def convert(src: Path, dst: Path, seconds: float, mono: bool):
    fade = min(0.15, seconds / 4)
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-t", str(seconds),
           "-af", f"afade=t=out:st={seconds - fade}:d={fade}"]
    if mono:
        cmd += ["-ac", "1"]
    cmd += ["-ar", "44100", "-b:a", "128k", str(dst)]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.dry_run and not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is needed: brew install ffmpeg")

    manifest = {}
    jobs = []
    for sound, (mic, folder, art, layers, rrs, seconds, mono) in KIT.items():
        manifest[sound] = []
        for layer in layers:
            takes = []
            for rr in rrs:
                name = f"{sound}-v{layer}" + (f"-r{rr}" if rr else "") + ".mp3"
                takes.append(name)
                jobs.append((f"{REPO}/{mic}/{folder}/{source_name(mic, art, layer, rr)}", name, seconds, mono))
            manifest[sound].append(takes)

    if args.dry_run:
        for url, name, *_ in jobs:
            print(name, "<-", url)
        return

    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for url, name, seconds, mono in jobs:
            src = Path(tmp) / "in.flac"
            download(url, src)
            convert(src, OUT / name, seconds, mono)
            print("wrote", name)
    (OUT / "kit.json").write_text(json.dumps(manifest, indent=1) + "\n")
    (OUT / "LICENSE.md").write_text(LICENSE)
    print(f"{len(jobs)} samples in {OUT}")


if __name__ == "__main__":
    main()
