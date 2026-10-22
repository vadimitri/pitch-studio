// In-browser recogniser, main-thread side: owns the ASR worker (asr.worker.ts) and maps takes onto it.
// The main thread only copies 250 ms PCM chunks into the worker; VAD, Whisper and Uhm all run there.
// Debug: `?asr=wasm` (or `#/studio?asr=wasm`) forces the WASM fallback, `?asr=webgpu` skips the f16 check.
import { createStore, type Store } from "../store";
import type { FillerHit, SpeechLang, Transcript, Word } from "../types";
import type { AsrStatus, TakeAsr } from "./index";
import type { ForceDevice, FromWorker, ToWorker } from "./protocol";

type Result = { transcript: Transcript | null; fillerHits: FillerHit[] | null };
const NONE: Result = { transcript: null, fillerHits: null };

export interface ChunkTrace { take: number; audioSec: number; ms: number; waitMs: number; at: number }
/** Per-chunk timings (dev/diagnostics only). */
export const asrTrace = createStore<ChunkTrace[]>([]);
/** Worker debug lines (dev builds only). */
export const asrDebug = createStore<string[]>([]);

export function forcedDevice(): ForceDevice {
  try {
    const v = new URLSearchParams(location.search).get("asr") ?? new URLSearchParams(location.hash.split("?")[1] ?? "").get("asr");
    return v === "wasm" || v === "webgpu" ? v : null;
  } catch {
    return null;
  }
}

interface Pending {
  lang: SpeechLang;
  live: Store<{ words: Word[] }>;
  t0: number;
  done?: (r: Result) => void;
  alive?: () => void; // worker made progress on this take
}

/** finish() gives up after this long without progress from the worker (a stuck GPU, a throttled tab). */
const STALL_MS = 180_000;

export function createAsr(status: Store<AsrStatus>) {
  let worker: Worker | null = null;
  let nextId = 1;
  const takes = new Map<number, Pending>();

  const send = (m: ToWorker, transfer: Transferable[] = []) => worker?.postMessage(m, transfer);

  function fail(error: string) {
    status.patch({ state: "error", error });
    worker?.terminate();
    worker = null;
    for (const p of takes.values()) p.done?.(NONE);
    takes.clear();
  }

  function onMessage(m: FromWorker) {
    if (m.type === "status") { status.patch(m.status); return; }
    if (m.type === "debug") { asrDebug.set((a) => [...a, m.msg]); return; }
    const p = takes.get(m.id);
    if (m.type === "chunk") {
      asrTrace.set((a) => [...a.slice(-199), { take: m.id, audioSec: m.audioSec, ms: m.ms, waitMs: m.waitMs, at: performance.now() }]);
      p?.alive?.();
      return;
    }
    if (!p) return;
    if (m.type === "words") { p.live.set({ words: [...p.live.get().words, ...m.words] }); p.alive?.(); return; }
    takes.delete(m.id);
    const words = m.words;
    p.done?.({
      transcript: words
        ? { words, text: words.map((w) => w.w).join(" "), engine: m.engine, ms: Math.round(performance.now() - p.t0), lang: p.lang }
        : null,
      fillerHits: m.fillerHits,
    });
  }

  function ensureWorker(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      status.patch({ state: "unsupported", engine: "none" });
      return null;
    }
    try {
      worker = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      status.patch({ state: "error", error: String(e) });
      return null;
    }
    worker.onmessage = (ev: MessageEvent<FromWorker>) => onMessage(ev.data);
    worker.onerror = (ev) => fail(ev.message || "ASR worker crashed");
    status.patch({ state: "loading", progress: 0, error: undefined });
    send({ type: "load", force: forcedDevice() });
    // ~0.6 GB of weights in Cache Storage: ask the browser not to evict them (silent in Chrome/Safari).
    if (!/firefox/i.test(navigator.userAgent)) void navigator.storage?.persist?.().catch(() => false);
    return worker;
  }

  return {
    preload() {
      const s = status.get().state;
      if (!worker || s === "error") {
        if (s === "error") { worker?.terminate(); worker = null; }
        ensureWorker();
      }
    },

    begin(lang: SpeechLang): TakeAsr {
      ensureWorker();
      const id = nextId++;
      const live = createStore<{ words: Word[] }>({ words: [] });
      const pending: Pending = { lang, live, t0: 0 };
      takes.set(id, pending);
      send({ type: "begin", id, lang });
      let covered = 0;
      let finished: Promise<Result> | null = null;
      let cancelled = false;

      return {
        live,
        push(pcm, start) {
          if (cancelled || finished || !worker) return;
          const copy = pcm.slice(); // the caller keeps its chunks for the full take
          covered = Math.max(covered, start + copy.length);
          send({ type: "pcm", id, pcm: copy, start }, [copy.buffer]);
        },
        finish(all) {
          if (finished) return finished;
          finished = new Promise<Result>((resolve) => {
            if (cancelled || !worker || !takes.has(id)) return resolve(NONE);
            pending.t0 = performance.now();
            let timer = 0;
            const stalled = () => {
              takes.delete(id);
              send({ type: "cancel", id });
              resolve(NONE);
            };
            pending.alive = () => { clearTimeout(timer); timer = window.setTimeout(stalled, STALL_MS); };
            pending.alive();
            pending.done = (r) => { clearTimeout(timer); resolve(r); };
            const tail = all.length > covered ? all.slice(covered) : new Float32Array(0);
            send({ type: "finish", id, tail, total: Math.max(all.length, covered) }, [tail.buffer]);
          });
          return finished;
        },
        cancel() {
          if (cancelled) return;
          cancelled = true;
          takes.delete(id);
          send({ type: "cancel", id });
          pending.done?.(NONE);
        },
      };
    },
  };
}
