#!/usr/bin/env python3
"""Measure a whole track bar by bar: how each part changes over the performance.

Where scripts/analyze_reference.py averages a track into one profile, this follows it
bar by bar, with the beat grid re-fitted every two bars so tempo drift doesn't smear it.
Per bar and band (sub, low-mid, mid, upper, hat) it measures energy, onsets on 24 steps
and hits, and from those:
- variety: novelty (1 minus the correlation with the previous bar), likeness at lags of
  1, 2, 4 bars and the form, distinct patterns per 32 bars (clusters at r > 0.8)
- timing: SD of onsets around the grid (ms) for bass, cymbals and comping; tempo drift
- swing: the offbeat's place in the beat per chorus and its spread bar to bar
- accents: cymbal strength on beats 1 to 4 per chorus, and the spread of onset strengths
- cymbal sustain and brightness, crashes, fills, comping register and sustain
- the same per chorus and per bar of the form
The JSON (--json) also holds the per-bar series and grids.

  python3 scripts/analyze_timeline.py TRACK --bpm 140 --bar1 3.06 --form 32 --json out.json

--bpm and --bar1 come from scripts/analyze_reference.py or a site recording's .json.
Needs ffmpeg and numpy. Numbers and what they showed: context/whole-track-comparison.md.
"""
import argparse, json, subprocess
import numpy as np

SR = 22050
HOP = 128
N = 1024
BANDS = {"sub": (40, 110), "lowmid": (110, 250), "mid": (250, 1500), "upper": (1500, 5000), "hat": (6000, 11000)}
STEPS = 24


def decode(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def spec(x):
    fr = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP] * np.hanning(N)
    return np.abs(np.fft.rfft(fr, axis=1)).astype(np.float32), np.fft.rfftfreq(N, 1 / SR)


def flux(S, f, lo, hi):
    e = np.log1p(10 * S[:, (f >= lo) & (f < hi)].sum(1))
    return np.maximum(0, np.diff(e, prepend=e[0]))


def peaks(env, thr, mind=8):
    i = np.where((env[1:-1] > thr) & (env[1:-1] >= env[:-2]) & (env[1:-1] > env[2:]))[0] + 1
    keep = []
    taken = np.zeros(len(env), bool)
    for j in i[np.argsort(-env[i])]:
        if not taken[max(0, j - mind + 1):j + mind].any():
            keep.append(j)
            taken[j] = True
    i = np.array(sorted(keep), dtype=int)
    a, b, c = env[i - 1], env[i], env[i + 1]
    den = a - 2 * b + c
    d = np.where(np.abs(den) > 1e-9, 0.5 * (a - c) / np.where(np.abs(den) > 1e-9, den, 1), 0)
    return i + np.clip(d, -0.5, 0.5), b


def corr(a, b):
    if a.std() == 0 or b.std() == 0:
        return np.nan
    return float(np.corrcoef(a, b)[0, 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("track"); ap.add_argument("--bpm", type=float, required=True); ap.add_argument("--bar1", type=float, required=True)
    ap.add_argument("--form", type=int, default=32); ap.add_argument("--json"); ap.add_argument("--label", default="")
    ap.add_argument("--max-bars", type=int, default=0)
    a = ap.parse_args()
    x = decode(a.track)
    fps = SR / HOP
    S, f = spec(x)
    beat = 60 / a.bpm
    bar = 4 * beat
    nb = int((len(x) / SR - a.bar1) / bar) - 1
    if a.max_bars:
        nb = min(nb, a.max_bars)
    P = S ** 2
    fr = lambda t: int(round(t * fps))

    # Beat tracking: every 2 bars, the offset within +-1/4 beat of the last one that best fits a beat grid.
    full = flux(S, f, 40, 11000)
    W = 2
    offs, prev = [], 0.0
    cands = np.arange(-0.25, 0.25, 0.005) * beat
    for w in range(nb // W):
        t0 = a.bar1 + w * W * bar
        ks = np.arange(4 * W) * beat
        def score(d):
            s = 0.0
            for k in ks:
                i = fr(t0 + prev + d + k)
                if 1 <= i < len(full) - 2:
                    s += full[i - 1:i + 2].max()
            return s
        sc = [score(d) for d in cands]
        prev += cands[int(np.argmax(sc))]
        offs.append(prev)
    offs = np.array(offs)
    tw = np.arange(len(offs)) * W * bar
    slope, icpt = np.polyfit(tw, offs, 1) if len(offs) > 3 else (0.0, 0.0)
    resid = offs - (slope * tw + icpt)
    sm = np.array([np.median(offs[max(0, i - 1):i + 2]) for i in range(len(offs))])
    bar_off = np.interp(np.arange(nb) * bar, tw, sm) if len(sm) else np.zeros(nb)
    starts = a.bar1 + np.arange(nb) * bar + bar_off
    ends = np.append(starts[1:], starts[-1] + bar)
    edges = np.append(starts, ends[-1])
    # local tempo per 8 bars from the offsets
    loc = []
    for w0 in range(0, len(offs) - 4, 4):
        s_, _ = np.polyfit(tw[w0:w0 + 4], offs[w0:w0 + 4], 1)
        loc.append(a.bpm / (1 + s_))
    tempo_info = {"nominal_bpm": a.bpm, "fitted_bpm": round(float(a.bpm / (1 + slope)), 2),
                  "phase_resid_sd_ms": round(float(resid.std() * 1000), 1), "phase_resid_range_ms": round(float(np.ptp(resid) * 1000), 1),
                  "local_bpm_sd": round(float(np.std(loc)), 2) if loc else None, "local_bpm_range": round(float(np.ptp(loc)), 2) if loc else None}

    band_energy, grids, hits, pk = {}, {}, {}, {}
    for name, (lo, hi) in BANDS.items():
        env = flux(S, f, lo, hi)
        sel = (f >= lo) & (f < hi)
        pw = P[:, sel].sum(1)
        band_energy[name] = np.array([10 * np.log10(pw[fr(starts[b]):fr(ends[b])].sum() + 1e-9) for b in range(nb)])
        g = np.zeros((nb, STEPS))
        for b in range(nb):
            for s in range(STEPS):
                i = fr(starts[b] + s * (ends[b] - starts[b]) / STEPS)
                g[b, s] = env[max(0, i - 2):i + 3].max() if i < len(env) else 0
        grids[name] = g
        t, h = peaks(env, env.mean() + env.std())
        pk[name] = (t / fps, h)
        hits[name] = np.histogram(t / fps, bins=edges)[0]

    total = 10 * np.log10(sum(10 ** (band_energy[k] / 10) for k in BANDS))
    alive = total > np.median(total) - 15
    out = {"label": a.label, "track": a.track, "bpm": a.bpm, "bar1": a.bar1, "form": a.form, "bars": nb, "tempo": tempo_info}

    var = {}
    for name, g in grids.items():
        nov = [1 - corr(g[b], g[b - 1]) for b in range(1, nb) if alive[b] and alive[b - 1]]
        lag = lambda L: [corr(g[b], g[b - L]) for b in range(L, nb) if alive[b] and alive[b - L]]
        lf = lag(a.form)
        cents = []
        for b in range(nb):
            if not alive[b] or g[b].std() == 0:
                continue
            v = g[b] - g[b].mean(); v = v / (np.linalg.norm(v) + 1e-9)
            if not any(float(v @ c) > 0.8 for c in cents):
                cents.append(v)
        var[name] = {"novelty": round(float(np.nanmean(nov)), 3), "lag1": round(float(np.nanmean(lag(1))), 3), "lag2": round(float(np.nanmean(lag(2))), 3),
                     "lag4": round(float(np.nanmean(lag(4))), 3), "lagform": round(float(np.nanmean(lf)), 3) if lf else None,
                     "distinct_per_32": round(len(cents) / max(1, alive.sum()) * 32, 1),
                     "energy_sd_db": round(float(np.std(band_energy[name][alive])), 2),
                     "energy_bar_to_bar_db": round(float(np.mean(np.abs(np.diff(band_energy[name][alive])))), 2),
                     "hits_per_bar": round(float(hits[name][alive].mean()), 2), "hits_sd": round(float(hits[name][alive].std()), 2)}
    out["variety"] = var

    def beatpos(t):
        return np.interp(t, edges, np.arange(nb + 1) * 4.0)

    def timing(name, grid_beats, window):
        t, h = pk[name]
        keep = (t > starts[0]) & (t < ends[-1])
        rel = beatpos(t[keep])
        dev, pos = [], []
        for r in rel:
            frac = r - np.floor(r)
            dists = [frac - q for q in grid_beats]
            d = min(dists, key=abs)
            if abs(d) < window:
                dev.append(d * beat * 1000); pos.append(r)
        dev, pos = np.array(dev), np.array(pos)
        if len(dev) < 20:
            return None
        return {"sd_ms": round(float(dev.std()), 1), "mad_ms": round(float(np.median(np.abs(dev - np.median(dev)))), 1),
                "mean_ms": round(float(dev.mean()), 1), "n": int(len(dev))}

    out["timing"] = {"sub_on_beats": timing("sub", [0.0, 1.0], 0.12), "hat_on_beats": timing("hat", [0.0, 1.0], 0.08),
                     "mid_on_eighths": timing("mid", [0.0, 0.5, 0.667, 1.0], 0.07)}

    t, h = pk["hat"]
    rel = beatpos(t)
    nch = int(np.ceil(nb / a.form))
    chor = []
    for c in range(nch):
        sel = (rel >= c * a.form * 4) & (rel < (c + 1) * a.form * 4)
        fracs = rel[sel] % 1
        off = fracs[(fracs > 0.45) & (fracs < 0.85)]
        chor.append(round(float(np.median(off)), 3) if len(off) > 10 else None)
    out["swing_offbeat_pos_by_chorus"] = chor
    # spread of the offbeat position, bar by bar (how much the swing breathes)
    perbar = []
    for b in range(nb):
        sel = (rel >= b * 4) & (rel < b * 4 + 4)
        fracs = rel[sel] % 1
        off = fracs[(fracs > 0.45) & (fracs < 0.85)]
        if len(off) >= 2:
            perbar.append(float(np.median(off)))
    out["swing_bar_sd"] = round(float(np.std(perbar)), 3) if perbar else None

    def accent_profile(name):
        g = grids[name]
        res = []
        for c in range(nch):
            rows = [g[b] for b in range(c * a.form, min(nb, (c + 1) * a.form)) if alive[b]]
            if rows:
                m = np.mean(rows, 0)[[0, 6, 12, 18]]
                res.append([round(float(v / m.max()), 2) for v in m])
        return res
    out["hat_beat_accents_by_chorus"] = accent_profile("hat")

    def strength_cv(name, steps):
        v = grids[name][alive][:, steps].ravel()
        v = v[v > 0.05 * v.max()]
        return round(float(v.std() / v.mean()), 3)
    out["strength_cv"] = {"hat_beats": strength_cv("hat", [0, 6, 12, 18]), "sub_beats": strength_cv("sub", [0, 6, 12, 18]),
                          "mid_all": strength_cv("mid", list(range(0, 24, 3)) + [4, 10, 16, 22])}

    sel = (f >= 3000) & (f < 11000)
    hp = P[:, sel].sum(1)
    cen = (P[:, sel] * f[sel]).sum(1) / (hp + 1e-12)
    sus = np.array([float(np.median(hp[fr(starts[b]):fr(ends[b])]) / (hp[fr(starts[b]):fr(ends[b])].max() + 1e-12)) for b in range(nb)])
    cent = np.array([float(np.average(cen[fr(starts[b]):fr(ends[b])], weights=hp[fr(starts[b]):fr(ends[b])] + 1e-12)) for b in range(nb)])

    crash = np.zeros(nb)
    for b in range(1, nb):
        first = hp[fr(starts[b]):fr(starts[b] + beat)].sum()
        prv = hp[fr(starts[b - 1]):fr(starts[b])].sum() / 4
        crash[b] = 10 * np.log10((first + 1e-12) / (prv + 1e-12))

    hu = (hits["upper"] + hits["lowmid"]).astype(float)
    fill = (hu - np.median(hu[alive])) / (np.std(hu[alive]) + 1e-9)
    upper_rel = band_energy["upper"] - np.median(band_energy["upper"][alive])

    lo_sel = (f >= 250) & (f < 700); hi_sel = (f >= 700) & (f < 2000)
    lp, hpp = P[:, lo_sel].sum(1), P[:, hi_sel].sum(1)
    reg = np.array([10 * np.log10(hpp[fr(starts[b]):fr(ends[b])].sum() / (lp[fr(starts[b]):fr(ends[b])].sum() + 1e-12)) for b in range(nb)])
    mp = P[:, (f >= 250) & (f < 1500)].sum(1)
    msus = np.array([float(np.median(mp[fr(starts[b]):fr(ends[b])]) / (mp[fr(starts[b]):fr(ends[b])].max() + 1e-12)) for b in range(nb)])

    out["cymbal"] = {"sustain_mean": round(float(sus[alive].mean()), 3), "sustain_sd": round(float(sus[alive].std()), 3),
                     "centroid_mean": round(float(cent[alive].mean())), "centroid_sd": round(float(cent[alive].std()))}
    out["comp"] = {"register_db_mean": round(float(reg[alive].mean()), 2), "register_sd": round(float(reg[alive].std()), 2),
                   "sustain_mean": round(float(msus[alive].mean()), 3), "sustain_sd": round(float(msus[alive].std()), 3)}

    pc = []
    for c in range(nch):
        r = [b for b in range(c * a.form, min(nb, (c + 1) * a.form)) if alive[b]]
        if len(r) < a.form // 2:
            continue
        pc.append({"chorus": c + 1, "bars": len(r),
                   "db": {k: round(float(np.mean(band_energy[k][r]) - np.mean(band_energy[k][alive])), 1) for k in BANDS},
                   "hits": {k: round(float(hits[k][r].mean()), 1) for k in BANDS},
                   "novelty": {k: round(float(np.nanmean([1 - corr(grids[k][b], grids[k][b - 1]) for b in r if b > 0])), 2) for k in BANDS},
                   "cym_sustain": round(float(sus[r].mean()), 3), "cym_centroid": round(float(cent[r].mean())),
                   "comp_register": round(float(reg[r].mean()), 2), "comp_sustain": round(float(msus[r].mean()), 3),
                   "fills": int((fill[r] > 1).sum()), "crashes": int((crash[r] > 4).sum())})
    out["per_chorus"] = pc

    pos = []
    for p in range(a.form):
        r = [b for b in range(p, nb, a.form) if alive[b]]
        pos.append(None if not r else {"fill_z": round(float(np.mean(fill[r])), 2), "upper_db": round(float(np.mean(upper_rel[r])), 1),
                                       "crash_db": round(float(np.mean(crash[r])), 1), "total_db": round(float(np.mean(total[r] - np.median(total[alive]))), 1)})
    out["by_form_pos"] = pos
    big = [b for b in range(nb) if alive[b] and fill[b] > 1.0]
    out["fill_bars_mod4"] = np.bincount([b % 4 for b in big], minlength=4).tolist()
    out["fill_bars_mod8"] = np.bincount([b % 8 for b in big], minlength=8).tolist()
    out["fill_rate"] = round(len(big) / max(1, alive.sum()), 3)
    cr = [b for b in range(nb) if alive[b] and crash[b] > 4]
    out["crash_bars_mod8"] = np.bincount([b % 8 for b in cr], minlength=8).tolist()
    out["crash_rate"] = round(len(cr) / max(1, alive.sum()), 3)
    out["series"] = {"total_db": (total - np.median(total[alive])).round(1).tolist(),
                     **{f"{k}_db": (band_energy[k] - np.median(band_energy[k][alive])).round(1).tolist() for k in BANDS},
                     **{f"{k}_hits": hits[k].tolist() for k in BANDS}, "cym_sustain": sus.round(3).tolist(), "cym_centroid": cent.round(0).tolist(),
                     "comp_register": reg.round(2).tolist(), "comp_sustain": msus.round(3).tolist(), "fill_z": fill.round(2).tolist(),
                     "crash_db": crash.round(1).tolist(), "alive": alive.astype(int).tolist(), "bar_offset_ms": (bar_off * 1000).round(1).tolist(),
                     **{f"{k}_grid": grids[k].round(3).tolist() for k in ("sub", "mid", "hat", "upper", "lowmid")}}
    if a.json:
        json.dump(out, open(a.json, "w"))
    print(a.label, "ok", tempo_info)


if __name__ == "__main__":
    main()
