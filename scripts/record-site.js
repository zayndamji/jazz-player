// Record what the site plays, for scripts/analyze_reference.py: start playback on a
// tune page (dev server), then run this in the page (console or a browser tool).
// It records `SECONDS` of the band before the Mute button (so it works muted), saves
// tunes/<id>/analysis/site-<style>.webm plus a .json with the tempo and where the
// first chorus starts in the recording, and returns the analyzer command to run.
// Set window.RECORD_SECONDS and window.RECORD_NAME first to change the length and name.
// From a browser tool: eval(await (await fetch("/scripts/record-site.js")).text()).
// Needs `npm run dev` (window.__jazzPlayer and the /__recording endpoint from
// scripts/save-recordings.mjs).
(async () => {
  const SECONDS = window.RECORD_SECONDS ?? 60;
  const NAME = window.RECORD_NAME ?? ""; // file name without extension; default site-<style>
  const hook = window.__jazzPlayer;
  if (!hook?.player?.schedule) return "Start playback on a tune page under npm run dev first.";
  const { Tone, preMute, player } = hook;
  const tune = location.hash.match(/#\/tune\/([a-z0-9-]+)/)?.[1];
  if (!tune) return "Open a tune page first.";
  const transport = Tone.getTransport();
  const ctx = Tone.getContext().rawContext;
  const dest = ctx.createMediaStreamDestination();
  preMute.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 256000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  const startBeat = transport.ticks / transport.PPQ;
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  rec.stop();
  await stopped;
  preMute.disconnect(dest);

  const schedule = player.schedule;
  const bpm = transport.bpm.value;
  const formStarts = schedule.bars.filter((b) => b.ref?.part === "form" && b.ref.section === 0 && b.ref.bar === 0).map((b) => b.startBeat);
  const formBars = new Set(schedule.bars.filter((b) => b.ref?.part === "form").map((b) => `${b.ref.section}.${b.ref.bar}`)).size;
  const first = formStarts.find((b) => b >= startBeat) ?? formStarts[0];
  // Tone schedules lookAhead seconds early, so the Transport is that far ahead of what's heard.
  const bar1 = ((first - startBeat) * 60) / bpm + Tone.getContext().lookAhead;
  const style = schedule.mix && document.querySelector(".meta span")?.textContent?.toLowerCase().replace(/[^a-z]+/g, "-");
  const name = NAME || `site-${style || "band"}`;
  const post = (file, body) => fetch(`/__recording?tune=${tune}&name=${file}`, { method: "POST", body }).then((r) => r.text());
  const saved = await post(`${name}.webm`, new Blob(chunks, { type: "audio/webm" }));
  const info = { tune, bpm, bar1: Number(bar1.toFixed(3)), formBars, seconds: SECONDS, recordedFromBeat: startBeat };
  await post(`${name}.json`, JSON.stringify(info, null, 1));
  return { saved, ...info, analyze: `python3 scripts/analyze_reference.py ${saved} --bpm ${bpm} --bar1 ${info.bar1} --form ${formBars}` };
})();
