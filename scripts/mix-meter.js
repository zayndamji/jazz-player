// Mix meter: share of energy per frequency band of what the site is playing,
// in the same bands as scripts/analyze_reference.py, for comparing a style's
// mix with a reference track. Start playback in the page, then paste this into
// the browser console (or run it with a browser automation tool). It listens
// for 15 seconds and returns { peak, share }. It only listens; it changes nothing.
// It listens before the site's Mute button, so it works with the sound muted.
// Needs the dev server (npm run dev), which exposes window.__jazzTeacher.
(async () => {
  const hook = window.__jazzTeacher;
  if (!hook) return "No window.__jazzTeacher: run the dev server and start playback first.";
  const { Tone, preMute } = hook;
  const ctx = Tone.getContext().rawContext;
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  preMute.connect(an);
  const hz = ctx.sampleRate / an.fftSize;
  const F = new Float32Array(an.frequencyBinCount);
  const T = new Float32Array(an.fftSize);
  const bands = { sub: [40, 110], "low-mid": [110, 250], mid: [250, 1500], upper: [1500, 5000], hat: [6000, 11000] };
  const E = Object.fromEntries(Object.keys(bands).map((k) => [k, 0]));
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 50));
    an.getFloatFrequencyData(F);
    an.getFloatTimeDomainData(T);
    for (const v of T) peak = Math.max(peak, Math.abs(v));
    F.forEach((db, k) => {
      const f = k * hz;
      for (const [name, [lo, hi]] of Object.entries(bands)) if (f >= lo && f < hi) E[name] += 10 ** (db / 10);
    });
  }
  preMute.disconnect(an);
  const total = Object.values(E).reduce((a, b) => a + b, 0);
  const share = Object.fromEntries(Object.entries(E).map(([k, v]) => [k, Number((10 * Math.log10(v / total)).toFixed(1))]));
  return { peak: Number(peak.toFixed(2)), share };
})();
