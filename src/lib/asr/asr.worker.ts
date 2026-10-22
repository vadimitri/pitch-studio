/// <reference lib="webworker" />
// ASR worker: owns transformers.js + ONNX Runtime. Receives the take's 16 kHz PCM while recording, cuts it
// into VAD chunks, transcribes them one by one (WebGPU: while recording; WASM fallback: after stop), then
// runs the Uhm filler detector over the whole take. Nothing leaves the device except model downloads.
// Uhm runs on the app's onnxruntime-web; transformers.js brings (and pins) its own copy for Whisper. Registering
// ours under Symbol.for("onnxruntime") would make transformers 4.3.1 reject every device, so there are two.
import * as ort from "onnxruntime-web/webgpu";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import type { FillerHit, SpeechLang, Word } from "../types";
import { FILLER_PROMPT, MIN_SPEECH_SEC, applyGuards, isHallucination, maxNewTokens } from "./guards";
import type { ForceDevice, FromWorker, ToWorker } from "./protocol";
import { stitchWords, type RawWord } from "./stitch";
import { UHM_URL, UHM_WIN, argmaxFrames, uhmHits, uhmKeep, uhmWindows } from "./uhm";
import { Chunker, SR, mergeChunks, type Chunk } from "./vad";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
const T0 = performance.now();
const dbg = (msg: string) => { if (import.meta.env.DEV) post({ type: "debug", msg: `${((performance.now() - T0) / 1000).toFixed(1)}s ${msg}` }); };
const CACHE = "transformers-cache"; // transformers.js' Cache Storage bucket; Uhm goes into the same one

interface Spec { id: string; dtype: "q4f16" | "q8"; device: "webgpu" | "wasm"; label: string; files: string[] }
const LARGE: Spec = {
  id: "onnx-community/whisper-large-v3-turbo_timestamped", dtype: "q4f16", device: "webgpu",
  label: "Whisper large-v3 turbo · WebGPU", files: ["onnx/encoder_model_q4f16.onnx", "onnx/decoder_model_merged_q4f16.onnx"],
};
const SMALL: Spec = {
  id: "onnx-community/whisper-small_timestamped", dtype: "q8", device: "wasm",
  label: "Whisper small · WASM", files: ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
};

interface AsrOut { text: string; chunks?: RawWord[] }
/** The parts of transformers' ASR pipeline used here. */
interface Asr {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<AsrOut>;
  processor(audio: Float32Array): Promise<{ input_features: unknown }>;
  model: { generate(o: Record<string, unknown>): Promise<{ sequences: { tolist(): unknown[][] }; token_timestamps: { tolist(): number[][] } }> };
  tokenizer: {
    encode(t: string, o?: { add_special_tokens?: boolean }): number[];
    convert_tokens_to_ids(t: string): number;
    timestamp_begin: number;
    _decode_asr(chunks: unknown[], o: Record<string, unknown>): [string, { chunks?: RawWord[] }];
  };
}
interface Model { asr: Asr; spec: Spec; init: Partial<Record<SpeechLang, number[]>>; direct: boolean }

interface Take {
  id: number;
  lang: SpeechLang;
  buf: Float32Array;
  len: number;
  chunker: Chunker;
  chunks: Chunk[];
  closedAt: number[];
  next: number;
  words: Word[];
  ran: number;
  errors: number;
  finishing: boolean;
  cancelled: boolean;
  merged?: boolean;
}

let force: ForceDevice = null;
let model: Model | null = null;
let loadP: Promise<Model> | null = null;
let loadFailed = false;
const takes = new Map<number, Take>();

// ── loading ──

function isSafariBelow26() {
  const ua = navigator.userAgent;
  if (!/Apple/.test(navigator.vendor || "") || /Chrome|CriOS|FxiOS|EdgiOS|Android/.test(ua)) return false;
  const m = ua.match(/Version\/(\d+)/);
  return !!m && +m[1] < 26;
}

/** transformers' ORT WASM, self-hosted by scripts/vendor.mjs (CSP: no CDN scripts) in a versioned folder. */
function ortBase(version: string): string {
  const dir = `vendor/ort-asr/${version}/`;
  return import.meta.env.DEV ? new URL("/" + dir, self.location.origin).href : new URL("../" + dir, import.meta.url).href;
}

async function webgpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<{ features: Set<string> } | null> } }).gpu;
    const ad = gpu && (await gpu.requestAdapter({ powerPreference: "high-performance" }));
    return !!ad && ad.features.has("shader-f16");
  } catch {
    return false;
  }
}

async function isCached(spec: Spec): Promise<boolean> {
  try {
    const c = await caches.open(CACHE);
    const hits = await Promise.all(spec.files.map((f) => c.match(`https://huggingface.co/${spec.id}/resolve/main/${f}`)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

function progressReporter() {
  let last = 0, lastAt = 0;
  return (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress_total" || !p.total) return;
    const v = Math.min(0.99, (p.loaded ?? 0) / p.total);
    const now = performance.now();
    if (v - last < 0.005 && now - lastAt < 500) return;
    last = v; lastAt = now;
    post({ type: "status", status: { progress: Math.round(v * 1000) / 1000 } });
  };
}

async function load(): Promise<Model> {
  const T = await import("@huggingface/transformers");
  T.env.allowLocalModels = false;
  T.env.allowRemoteModels = true;
  // ORT loads its own .mjs/.wasm from wasmPaths. transformers' wasm cache would re-import the factory from a blob:
  // URL instead, which hangs model loading in Safari 27's module worker (Chrome is fine).
  T.env.useWasmCache = false;
  const onnx = T.env.backends.onnx as unknown as typeof ort.env; // transformers' own ORT
  const variant = isSafariBelow26() && !("gpu" in navigator) ? "ort-wasm-simd-threaded" : "ort-wasm-simd-threaded.asyncify";
  const base = ortBase(onnx.versions.web ?? "");
  onnx.wasm.wasmPaths = { mjs: `${base}${variant}.mjs`, wasm: `${base}${variant}.wasm` };
  ort.env.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href };
  if (!self.crossOriginIsolated) onnx.wasm.numThreads = ort.env.wasm.numThreads = 1;

  const order = force === "wasm" ? [SMALL] : force === "webgpu" || (await webgpuF16()) ? [LARGE, SMALL] : [SMALL];
  let err: unknown = null;
  for (const spec of order) {
    try {
      const cached = await isCached(spec);
      post({ type: "status", status: { state: "loading", progress: 0, engine: spec.label, cached, error: undefined } });
      const asr = (await T.pipeline("automatic-speech-recognition", spec.id, {
        device: spec.device,
        dtype: { encoder_model: spec.dtype, decoder_model_merged: spec.dtype },
        progress_callback: progressReporter(),
      })) as unknown as Asr;
      const m: Model = { asr, spec, init: {}, direct: true };
      const t0 = performance.now();
      if (spec.device === "webgpu") await warmup(m); // WASM has nothing to compile; a dry run would cost ~10 s CPU
      console.info(`[asr] ${spec.label} ready, warm-up ${Math.round(performance.now() - t0)} ms`);
      post({ type: "status", status: { state: "ready", progress: 1, engine: spec.label, cached } });
      model = m;
      uhmReady = initUhm(m); // background; separate ORT instance, so it may overlap with Whisper
      return m;
    } catch (e) {
      console.warn(`[asr] ${spec.label} failed`, e);
      err = e;
    }
  }
  post({ type: "status", status: { state: "error", error: String(err) } });
  throw err;
}

/** Starts loading on first use. A failed load stays failed (takes resolve without transcript) until the next preload. */
function ensureModel(): Promise<Model> {
  return model ? Promise.resolve(model) : (loadP ??= load().catch((e) => { loadFailed = true; throw e; }));
}

// ── recognition ──

function initTokens(m: Model, lang: SpeechLang): number[] {
  const hit = m.init[lang];
  if (hit) return hit;
  const tok = m.asr.tokenizer, id = (s: string) => tok.convert_tokens_to_ids(s);
  return (m.init[lang] = [id("<|startofprev|>"), ...tok.encode(FILLER_PROMPT[lang], { add_special_tokens: false }),
    id("<|startoftranscript|>"), id(`<|${lang}|>`), id("<|transcribe|>")]);
}

function decodeOptions(m: Model, lang: SpeechLang, durSec: number) {
  const init = initTokens(m, lang);
  return { language: lang, task: "transcribe", decoder_input_ids: init, max_new_tokens: maxNewTokens(durSec, init.length) };
}

/**
 * Whisper with word timestamps for one chunk (< 30 s). Same steps as the pipeline's _call_whisper, but with
 * num_frames in encoder frames (20 ms): 4.3.1 passes mel frames (10 ms), so the cross-attention DTW ran over
 * twice the audio and squashed words. Falls back to the pipeline if the internals ever change.
 */
async function transcribe(m: Model, audio: Float32Array, opts: Record<string, unknown>): Promise<AsrOut> {
  if (m.direct) {
    try {
      const { input_features } = await m.asr.processor(audio);
      const out = await m.asr.model.generate({
        inputs: input_features, ...opts, return_timestamps: true, return_token_timestamps: true, num_frames: Math.floor(audio.length / 320),
      });
      const seq = out.sequences.tolist()[0], ts = out.token_timestamps.tolist()[0];
      const pre = Math.max(seq.findIndex((t) => Number(t) >= m.asr.tokenizer.timestamp_begin), 0);
      const [text, extra] = m.asr.tokenizer._decode_asr(
        [{ stride: [audio.length / SR, 0, 0], tokens: seq.slice(pre), token_timestamps: ts.slice(pre).map((x) => Math.round(x * 100) / 100), is_last: true }],
        { time_precision: 0.02, return_timestamps: "word", force_full_sequences: false },
      );
      return { text, chunks: extra.chunks };
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      console.warn("[asr] direct decode unavailable, using the pipeline", e);
      m.direct = false;
    }
  }
  return m.asr(audio, { ...opts, return_timestamps: "word" });
}

/** Compiles the WebGPU shaders (encoder, decoder with cache, cross-attention timestamps) before the first take. */
async function warmup(m: Model) {
  const pcm = new Float32Array(SR);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.random() * 2 - 1) * 1e-3;
  await transcribe(m, pcm, { ...decodeOptions(m, "de", 1), max_new_tokens: 4 });
}

async function transcribeChunk(t: Take, m: Model) {
  const i = t.next++, c = t.chunks[i];
  const dur = (c.s1 - c.s0) / SR;
  if (c.speechSec < MIN_SPEECH_SEC) return;
  const t0 = performance.now(), waitMs = Math.round(t0 - t.closedAt[i]);
  dbg(`chunk ${i} start ${dur.toFixed(1)}s`);
  try {
    const out = await transcribe(m, t.buf.subarray(c.s0, c.s1), decodeOptions(m, t.lang, dur));
    const ms = Math.round(performance.now() - t0);
    post({ type: "chunk", id: t.id, audioSec: Math.round(dur * 100) / 100, ms, waitMs });
    t.ran++;
    if (t.cancelled || isHallucination(out.text, c.speechSec)) return;
    const words = applyGuards(stitchWords(out.chunks ?? [], c.s0 / SR, c.s1 / SR, c.regions), t.lang);
    if (!words.length) return;
    t.words.push(...words);
    post({ type: "words", id: t.id, words });
  } catch (e) {
    t.errors++;
    console.warn("[asr] chunk failed", e);
  }
}

async function finalize(t: Take, m: Model) {
  dbg(`finalize take ${t.id}`);
  takes.delete(t.id);
  const failed = t.errors > 0 && t.ran === 0;
  const speech = t.chunks.reduce((s, c) => s + c.speechSec, 0);
  const hits = failed || speech < MIN_SPEECH_SEC ? null : await runUhm(t, m);
  if (t.cancelled) return;
  post({
    type: "result", id: t.id, words: failed ? null : t.words, fillerHits: hits,
    engine: `${m.spec.label} · on device${hits ? " · fillers: Uhm" : ""}`,
  });
}

// ── Uhm filler detector (app ORT instance) ──

let uhmReady: Promise<ort.InferenceSession | null> | null = null;

async function fetchUhm(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  let r = await cache?.match(UHM_URL);
  if (!r) {
    r = await fetch(UHM_URL);
    if (!r.ok) throw new Error(`uhm ${r.status}`);
    if (cache) await cache.put(UHM_URL, r.clone()).catch(() => {});
  }
  return r.arrayBuffer();
}

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** Never throws; null = no Uhm (the transcript does not wait for it beyond a timeout). */
async function initUhm(m: Model): Promise<ort.InferenceSession | null> {
  try {
    const bytes = new Uint8Array(await fetchUhm());
    for (const ep of m.spec.device === "webgpu" ? ["webgpu", "wasm"] : ["wasm"]) {
      try {
        const t0 = performance.now();
        // memory pattern / arena off: ORT-Web otherwise grows its arena with every 30 s window (Desert Ant's note)
        const s = await ort.InferenceSession.create(bytes, {
          executionProviders: [ep], graphOptimizationLevel: "all", enableMemPattern: false, enableCpuMemArena: false, executionMode: "sequential",
        });
        if (ep === "webgpu") { // compile shaders now, not after the first take
          const warm = new ort.Tensor("float32", new Float32Array(UHM_WIN), [1, UHM_WIN]);
          (await s.run({ [s.inputNames[0]]: warm }))[s.outputNames[0]].dispose();
        }
        console.info(`[asr] Uhm ready on ${ep} in ${Math.round(performance.now() - t0)} ms`);
        dbg(`uhm ready ${ep}`);
        return s;
      } catch (e) {
        console.warn(`[asr] Uhm on ${ep} failed`, e);
      }
    }
  } catch (e) {
    console.warn("[asr] Uhm unavailable", e);
  }
  return null;
}

async function runUhm(t: Take, m: Model): Promise<FillerHit[] | null> {
  try {
    const s = await within((uhmReady ??= initUhm(m)), 20000, null);
    if (!s) return null;
    const t0 = performance.now();
    const [input] = s.inputNames, [output] = s.outputNames;
    const win = new Float32Array(UHM_WIN);
    const pred: number[] = [], conf: number[] = [];
    let peak: number[] = [];
    for (const w of uhmWindows(t.len)) {
      win.fill(0);
      win.set(t.buf.subarray(w.start, Math.min(t.len, w.start + UHM_WIN)));
      const out = await within(s.run({ [input]: new ort.Tensor("float32", win, [1, UHM_WIN]) }), 30000, null);
      if (!out) throw new Error("Uhm window timed out"); // a stuck detector must not hold back the transcript
      const probs = out[output];
      const keep = uhmKeep(probs.dims[1], w, t.len), C = probs.dims[2], data = probs.data as Float32Array;
      if (peak.length !== C) peak = new Array<number>(C).fill(0);
      for (let i = 0; i < keep * C; i++) if (data[i] > peak[i % C]) peak[i % C] = data[i];
      const a = argmaxFrames(data, keep, C);
      for (let i = 0; i < a.pred.length; i++) { pred.push(a.pred[i]); conf.push(a.conf[i]); }
      probs.dispose();
    }
    if (import.meta.env.DEV) {
      const n = peak.map(() => 0);
      pred.forEach((p) => n[p]++);
      console.info(`[asr] Uhm frames per class ${n.join("/")}, peak p ${peak.map((x) => x.toFixed(2)).join("/")}, ${Math.round(performance.now() - t0)} ms`);
    }
    return uhmHits(pred, conf, { classes: peak.length });
  } catch (e) {
    console.warn("[asr] Uhm failed", e);
    return null;
  }
}

// ── scheduling: one job at a time, takes in order ──

let pumping = false;

async function step(): Promise<boolean> {
  for (const t of takes.values()) {
    const hasChunk = t.next < t.chunks.length;
    if (t.cancelled || (!hasChunk && !t.finishing)) continue;
    let m: Model;
    try {
      m = await ensureModel();
    } catch (e) {
      if (!t.finishing) continue;
      takes.delete(t.id);
      post({ type: "result", id: t.id, words: null, fillerHits: null, engine: "", error: String(e) });
      return true;
    }
    if (t.cancelled) return true; // cancelled while the model was loading
    if (hasChunk && m.spec.device === "wasm" && t.finishing && !t.merged) {
      const rest = mergeChunks(t.chunks.slice(t.next));
      t.chunks.splice(t.next, Infinity, ...rest);
      t.closedAt.splice(t.next, Infinity, ...rest.map(() => performance.now()));
      t.merged = true;
    }
    if (hasChunk && (m.spec.device === "webgpu" || t.finishing)) { await transcribeChunk(t, m); return true; }
    if (!hasChunk && t.finishing) { await finalize(t, m); return true; }
  }
  return false;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (await step());
  } finally {
    pumping = false;
  }
}

function addChunks(t: Take, cs: Chunk[]) {
  for (const c of cs) { t.chunks.push(c); t.closedAt.push(performance.now()); }
}

function place(t: Take, pcm: Float32Array, start: number) {
  const end = start + pcm.length;
  if (end > t.buf.length) {
    const grown = new Float32Array(Math.max(end, t.buf.length * 2));
    grown.set(t.buf.subarray(0, t.len));
    t.buf = grown;
  }
  t.buf.set(pcm, start);
  t.len = Math.max(t.len, end);
}

scope.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case "load":
      force = data.force;
      if (loadFailed) { loadFailed = false; loadP = null; }
      void ensureModel().catch(() => {});
      return;
    case "begin":
      takes.set(data.id, {
        id: data.id, lang: data.lang, buf: new Float32Array(SR * 60), len: 0, chunker: new Chunker(), chunks: [], closedAt: [], next: 0,
        words: [], ran: 0, errors: 0, finishing: false, cancelled: false,
      });
      return;
    case "pcm": {
      const t = takes.get(data.id);
      if (!t || t.finishing) return;
      place(t, data.pcm, data.start);
      const closed = t.chunker.advance(t.buf, t.len);
      if (closed.length) { addChunks(t, closed); void pump(); }
      return;
    }
    case "finish": {
      const t = takes.get(data.id);
      dbg(`finish take ${data.id} known=${!!t} len=${t?.len} chunks=${t?.chunks.length}`);
      if (!t) { post({ type: "result", id: data.id, words: null, fillerHits: null, engine: "" }); return; }
      if (data.tail.length) place(t, data.tail, data.total - data.tail.length);
      addChunks(t, t.chunker.flush(t.buf, t.len));
      t.finishing = true;
      void pump();
      return;
    }
    case "cancel": {
      const t = takes.get(data.id);
      if (t) { t.cancelled = true; takes.delete(data.id); }
      return;
    }
  }
};
