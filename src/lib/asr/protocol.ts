// Messages between the ASR engine (main thread) and asr.worker.ts.
import type { FillerHit, SpeechLang, Word } from "../types";
import type { AsrStatus } from "./index";

export type ForceDevice = "wasm" | "webgpu" | null;

export type ToWorker =
  | { type: "load"; force: ForceDevice }
  | { type: "begin"; id: number; lang: SpeechLang }
  | { type: "pcm"; id: number; pcm: Float32Array; start: number }
  | { type: "finish"; id: number; tail: Float32Array; total: number }
  | { type: "cancel"; id: number };

export type FromWorker =
  | { type: "status"; status: Partial<AsrStatus> }
  | { type: "words"; id: number; words: Word[] }
  | { type: "chunk"; id: number; audioSec: number; ms: number; waitMs: number }
  | { type: "debug"; msg: string } // dev builds only
  | {
      type: "result";
      id: number;
      words: Word[] | null;
      engine: string;
      fillerHits: FillerHit[] | null;
      error?: string;
    };
