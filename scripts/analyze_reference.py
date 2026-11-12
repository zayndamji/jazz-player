#!/usr/bin/env python3
"""Measure a reference backing track, to model a style on it.

Prints tempo, swing ratio, where bar 1 falls, an onset profile per frequency
band on a grid of 24 steps per bar (6 per beat, so straight and swung eighths
both show), the share of energy per band, and the loudness of each form bar.
Per band it also gives how busy and how varied the part is: hits per bar
(onset peaks), how alike the bars are (the mean correlation of each bar's
onsets with the average bar: near 1 is the same pattern every bar), the
spread of per-bar energy in dB (dynamics), and where it sits in the stereo
field (share of energy on the left; 0.5 is centred).

  python3 scripts/analyze_reference.py TRACK.m4a
  python3 scripts/analyze_reference.py TRACK.m4a --bpm 160 --bar1 5.9 --form 32 --json out.json

Bar 1 is guessed from the first loud downbeat; pass --bar1 (seconds) when you
know it better, for example from a video's bar highlight. Needs ffmpeg and numpy.
"""

import argparse
import json
import subprocess
import sys

import numpy as np

SR = 22050
HOP = 256
BANDS = {"sub": (40, 110), "low-mid": (110, 250), "mid": (250, 1500), "upper": (1500, 5000), "hat": (6000, 11000)}
STEPS = 24  # per bar of 4/4


def decode(path, channels=1):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", str(channels), "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    return x if channels == 1 else x.reshape(-1, channels).T


def peaks(env):
    """Onset peaks: local maxima above the envelope's mean plus one standard deviation."""
    thr = env.mean() + env.std()
    return np.where((env[1:-1] > thr) & (env[1:-1] >= env[:-2]) & (env[1:-1] > env[2:]))[0] + 1


def spectrogram(x, n=1024):
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::HOP] * np.hanning(n)
    return np.abs(np.fft.rfft(frames, axis=1)), np.fft.rfftfreq(n, 1 / SR)


def onsets(S, f, lo, hi):
    e = np.log1p(10 * S[:, (f >= lo) & (f < hi)].sum(1))
    return np.maximum(0, np.diff(e, prepend=e[0]))


def tempo(flux, fps, lo=60, hi=240):
    seg = flux[int(10 * fps):int(130 * fps)] if len(flux) > 140 * fps else flux
    seg = seg - seg.mean()
    ac = np.correlate(seg, seg, "full")[len(seg) - 1:]
    lags = np.arange(len(ac)) / fps
    ok = (lags > 60 / hi) & (lags < 60 / lo)
    best = lags[ok][np.argmax(ac[ok])]
    bpm = 60 / best
    while bpm < 90:
        bpm *= 2
    while bpm > 200:
        bpm /= 2
    return bpm


def refine(flux, fps, bpm, span=0.02):
    """The tempo within +-2% of `bpm`, to 0.01 BPM, whose beat grid lines up best with the onsets over the
    whole track. A tempo off by a fraction of a BPM drifts a beat over a few minutes and flattens the profiles."""
    best, score = bpm, -1.0
    n = len(flux)
    for cand in np.arange(bpm * (1 - span), bpm * (1 + span), 0.01):
        beat = 60 / cand * fps
        k = np.arange(int(n / beat) - 1) * beat
        for ph in np.linspace(0, beat, 24, endpoint=False):
            v = flux[(k + ph).astype(int)].sum()
            if v > score:
                best, score = cand, v
    return float(best)


def spread(energy):
    """Standard deviation of per-bar energy in dB, leaving out near-silent bars (count-in, fade, tail)."""
    db = 10 * np.log10(energy + 1e-12)
    keep = db > np.median(db) - 20
    return round(float(np.std(db[keep])), 1)


def at(env, t, fps):
    i = int(round(t * fps))
    return env[max(0, i - 1):i + 2].max() if 0 <= i < len(env) else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("track")
    ap.add_argument("--bpm", type=float, help="tempo, if known")
    ap.add_argument("--bar1", type=float, help="time of bar 1 in seconds, if known")
    ap.add_argument("--form", type=int, default=32, help="bars in the form (default 32)")
    ap.add_argument("--json", help="also write the results here")
    a = ap.parse_args()

    x = decode(a.track)
    fps = SR / HOP
    S, f = spectrogram(x)
    full = onsets(S, f, 40, 11000)
    bpm = a.bpm or refine(full, fps, tempo(full, fps))
    beat = 60 / bpm
    bar = 4 * beat

    # Beat phase: where onsets line up best with the beat grid.
    phases = np.linspace(0, beat, 48, endpoint=False)
    start = float(np.argmax(np.abs(x) > 0.02)) / SR
    score = [sum(at(full, start + p + k * beat, fps) for k in range(200)) for p in phases]
    phase = start + phases[int(np.argmax(score))]
    if a.bar1 is not None:
        bar1 = a.bar1
    else:
        # The beat with the strongest low-band onsets over the first bars is taken as beat 1.
        sub = onsets(S, f, *BANDS["sub"])
        cand = [sum(at(sub, phase + (k + 4 * m) * beat, fps) for m in range(16)) for k in range(4)]
        bar1 = phase + int(np.argmax(cand)) * beat
    nbars = int((len(x) / SR - bar1) / bar) - 1

    profiles = {}
    busy = {}
    stereo = decode(a.track, 2)
    SL, _ = spectrogram(stereo[0])
    SR_, _ = spectrogram(stereo[1])
    for name, (lo, hi) in BANDS.items():
        env = onsets(S, f, lo, hi)
        grid = np.array([[at(env, bar1 + b * bar + s * bar / STEPS, fps) for s in range(STEPS)] for b in range(nbars)])
        p = grid.mean(0)
        profiles[name] = (p / p.max()).round(2).tolist()
        # Hits per bar, likeness of bars, dynamics and stereo position.
        frames = peaks(env) / fps
        per_bar = np.histogram(frames, bins=bar1 + bar * np.arange(nbars + 1))[0]
        alike = [np.corrcoef(g, p)[0, 1] for g in grid if g.std() > 0]
        sel = (f >= lo) & (f < hi)
        energy = np.array([(S[int((bar1 + b * bar) * fps):int((bar1 + (b + 1) * bar) * fps), sel] ** 2).sum() for b in range(nbars)])
        left, right = (SL[:, sel] ** 2).sum(), (SR_[:, sel] ** 2).sum()
        busy[name] = {"hits_per_bar": round(float(per_bar.mean()), 1), "bar_likeness": round(float(np.mean(alike)), 2),
                      "bar_energy_spread_db": spread(energy),
                      "left_share": round(float(left / (left + right + 1e-12)), 2)}

    # Swing: offbeat eighths at 3/6 of the beat are straight, at 4/6 swung (2:1).
    hat = np.array(profiles["hat"]).reshape(4, 6).mean(0)
    straight, swung = hat[3], hat[4]
    ratio = "swung (about 2:1)" if swung > straight * 1.15 else "straight" if straight > swung * 1.15 else "unclear"

    P = (S ** 2)
    share = {}
    total = sum(P[:, (f >= lo) & (f < hi)].sum() for lo, hi in BANDS.values())
    for name, (lo, hi) in BANDS.items():
        share[name] = round(10 * np.log10(P[:, (f >= lo) & (f < hi)].sum() / total), 1)

    loud = np.zeros(a.form)
    count = np.zeros(a.form)
    for b in range(nbars):
        seg = x[int((bar1 + b * bar) * SR):int((bar1 + (b + 1) * bar) * SR)]
        if len(seg):
            loud[b % a.form] += 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
            count[b % a.form] += 1
    loud = (loud / np.maximum(count, 1)).round(1).tolist()

    result = {"track": a.track, "bpm": round(bpm, 1), "bar1": round(bar1, 3), "bars": nbars, "swing": ratio,
              "swing_offbeat_straight_vs_swung": [round(float(straight), 2), round(float(swung), 2)],
              "band_share_db": share, "onset_profiles_24_per_bar": profiles, "form_bar_db": loud, "per_band": busy}

    print(f"tempo {result['bpm']} BPM, bar 1 at {result['bar1']} s, {nbars} bars, feel: {ratio}")
    print("band share dB:", " ".join(f"{k} {v}" for k, v in share.items()))
    head = "".join(("1" if s == 0 else str(s // 6 + 1)) if s % 6 == 0 else ("." if s % 3 else "&") for s in range(STEPS))
    print(f"{'':8} {' '.join(f'{c:>2}' for c in head)}")
    for name, p in profiles.items():
        print(f"{name:8} {' '.join(f'{round(v * 99):2d}' for v in p)}")
    print("loudness by form bar (dB):", " ".join(f"{v}" for v in loud))
    print(f"{'':8} hits/bar  likeness  spread dB  left share")
    for name, b in busy.items():
        print(f"{name:8} {b['hits_per_bar']:8}  {b['bar_likeness']:8}  {b['bar_energy_spread_db']:9}  {b['left_share']:10}")
    if a.json:
        import os
        os.makedirs(os.path.dirname(a.json) or ".", exist_ok=True)
        with open(a.json, "w") as fh:
            json.dump(result, fh, indent=1)


if __name__ == "__main__":
    sys.exit(main())
