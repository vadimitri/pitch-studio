// Speech recognition facade. Implementation: see ./engine (worker). The studio only talks to this API.
import { createStore } from "../store";
import type { FillerHit, SpeechLang, Transcript, Word } from "../types";

export interface AsrStatus {
  state: "idle" | "loading" | "ready" | "error" | "unsupported";
  progress: number; // 0..1 while downloading
  engine: string; // human readable
  cached: boolean;
  error?: string;
}

export const asrStatus = createStore<AsrStatus>({ state: "idle", progress: 0, engine: "", cached: false });

export interface TakeAsr {
  /** 16 kHz mono PCM chunk, `start` = sample index from the take start. */
  push(pcm: Float32Array, start: number): void;
  /** Words recognised so far (for live cues). */
  live: ReturnType<typeof createStore<{ words: Word[] }>>;
  finish(all: Float32Array): Promise<{ transcript: Transcript | null; fillerHits: FillerHit[] | null }>;
  cancel(): void;
}

type Impl = {
  preload(): void;
  begin(lang: SpeechLang): TakeAsr;
};

let impl: Promise<Impl> | null = null;
const getImpl = () => (impl ??= import("./engine").then((m) => m.createAsr(asrStatus)));

export function preloadAsr() {
  void getImpl().then((i) => i.preload()).catch((e) => asrStatus.patch({ state: "error", error: String(e) }));
}

/** Starts a take; chunks pushed before the engine is loaded are buffered. */
export function beginTakeAsr(lang: SpeechLang): TakeAsr {
  const live = createStore<{ words: Word[] }>({ words: [] });
  const pending: [Float32Array, number][] = [];
  let real: TakeAsr | null = null;
  let cancelled = false;
  const ready = getImpl().then((i) => {
    if (cancelled) return null;
    real = i.begin(lang);
    real.live.subscribe(() => live.set(real!.live.get()));
    for (const [p, s] of pending) real.push(p, s);
    pending.length = 0;
    return real;
  }).catch(() => null);
  return {
    live,
    push(pcm, start) {
      if (real) real.push(pcm, start);
      else pending.push([pcm, start]);
    },
    async finish(all) {
      const r = await ready;
      if (!r) return { transcript: null, fillerHits: null };
      return r.finish(all);
    },
    cancel() {
      cancelled = true;
      real?.cancel();
    },
  };
}
