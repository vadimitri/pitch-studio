// Dev-only: feeds a 16 kHz WAV through the real ASR engine in 250 ms chunks at real-time pace (like the
// capture worklet), then finish(). Result in window.__done for a Playwright runner.
import { mergeFillers } from "../../analysis/metrics";
import { isFilled } from "../../analysis/lexicon";
import { createStore } from "../../store";
import type { SpeechLang } from "../../types";
import { asrDebug, asrTrace, createAsr } from "../engine";
import type { AsrStatus } from "../index";

const q = new URLSearchParams(location.search);
const logEl = document.getElementById("log")!;
const log = (...a: unknown[]) => { logEl.textContent += a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"; };
const w = window as unknown as { __done?: unknown; __status?: AsrStatus };

function parseWav(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  let off = 12, data: Int16Array | null = null, sr = 0;
  while (off < dv.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, off, 4)), sz = dv.getUint32(off + 4, true);
    if (id === "fmt ") sr = dv.getUint32(off + 12, true);
    if (id === "data") data = new Int16Array(buf.slice(off + 8, off + 8 + sz));
    off += 8 + sz + (sz & 1);
  }
  if (sr !== 16000 || !data) throw new Error(`need 16 kHz mono PCM16, got ${sr}`);
  const f = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) f[i] = data[i] / 32768;
  return f;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const status = createStore<AsrStatus>({ state: "idle", progress: 0, engine: "", cached: false });
  let lastP = -1;
  status.subscribe(() => {
    const s = status.get();
    w.__status = s;
    if (s.state !== "loading" || s.progress - lastP >= 0.02) { lastP = s.progress; log(`${(performance.now() / 1000).toFixed(1)}s status`, s); }
  });
  asrDebug.subscribe(() => log("worker", asrDebug.get().at(-1) ?? ""));
  const asr = createAsr(status);
  const t0 = performance.now();
  asr.preload();
  // early=1: start the take before the model is ready (worker buffers); otherwise wait for ready
  if (!q.get("early")) {
    // subscription, not polling: Safari throttles timers of a tab that is not visible
    await new Promise<void>((res) => {
      const done = () => ["ready", "error", "unsupported"].includes(status.get().state) && res();
      status.subscribe(done);
      done();
    });
    if (status.get().state !== "ready") { w.__done = { ok: false, status: status.get() }; return; }
  }
  const loadMs = Math.round(performance.now() - t0);
  log("load ms", loadMs);

  const lang = (q.get("lang") ?? "de") as SpeechLang;
  const pace = Number(q.get("pace") ?? 1);
  const pcm = parseWav(await (await fetch(q.get("audio")!)).arrayBuffer());
  const audioSec = pcm.length / 16000;

  /** Feeds `pcm` like the capture worklet (250 ms pieces at `pace` × real time); returns the take and its timings. */
  async function record(stopAfterSec = Infinity) {
    const take = asr.begin(lang);
    const liveAt: { t: number; n: number }[] = [];
    const rec0 = performance.now();
    take.live.subscribe(() => liveAt.push({ t: Math.round((performance.now() - rec0) / 100) / 10, n: take.live.get().words.length }));
    for (let i = 0, k = 0; i < pcm.length && i < stopAfterSec * 16000; i += 4000, k++) {
      const wait = pace > 0 ? rec0 + (k * 250) / pace - performance.now() : 0; // pace=0: push everything at once
      if (wait > 0) await sleep(wait);
      take.push(pcm.slice(i, i + 4000), i);
    }
    return { take, liveAt, rec0 };
  }

  async function report(rec: Awaited<ReturnType<typeof record>>) {
    const fin0 = performance.now();
    const r = await rec.take.finish(pcm);
    const words = r.transcript?.words ?? [];
    const merged = mergeFillers(words, r.fillerHits);
    return {
      ok: !!r.transcript, afterStopMs: Math.round(performance.now() - fin0), transcriptMs: r.transcript?.ms,
      engine: r.transcript?.engine, nWords: words.length,
      fillersAsr: words.filter((x) => isFilled(x.w)).length,
      uhmHits: r.fillerHits?.length ?? null, fillersMerged: merged.length,
      mergedBySrc: merged.reduce<Record<string, number>>((a, f) => ((a[f.src] = (a[f.src] ?? 0) + 1), a), {}),
      live: rec.liveAt,
      text: r.transcript?.text,
      words: words.map((x) => `${x.w}@${x.s}-${x.e}`).join(" "),
      hits: r.fillerHits,
    };
  }

  const extra: Record<string, unknown> = {};
  if (q.get("cancel")) { // a take cancelled after 5 s must resolve empty and not disturb the next one
    const a = await record(5);
    const pa = a.take.finish(pcm.subarray(0, 5 * 16000));
    a.take.cancel();
    extra.cancelled = await pa;
  }
  const first = await record();
  let second: Promise<unknown> | null = null;
  if (q.get("seq")) { // next take starts while the first is still being finished
    const p1 = report(first);
    second = record().then(report);
    extra.first = await p1;
  }
  const main = second ? await second : await report(first);
  const result = {
    ...(main as object), ...extra, status: status.get(), loadMs, audioSec,
    chunks: asrTrace.get().map((c) => ({ take: c.take, sec: c.audioSec, ms: c.ms, wait: c.waitMs, rtf: Math.round((c.ms / 1000 / c.audioSec) * 1000) / 1000, at: Math.round((c.at - first.rec0) / 100) / 10 })),
  };
  log(result);
  w.__done = result;
  const to = q.get("post"); // for browsers without a driver (Safari): send the result to a local collector
  if (to) await fetch(to, { method: "POST", body: JSON.stringify({ ua: navigator.userAgent, ...result }) }).catch(() => {});
}

main().catch((e) => {
  log("ERROR", String(e?.stack ?? e));
  w.__done = { ok: false, error: String(e) };
  const to = q.get("post");
  if (to) void fetch(to, { method: "POST", body: JSON.stringify({ ua: navigator.userAgent, ok: false, error: String(e?.stack ?? e) }) });
});
