// "Uhm" filled-pause detector by Desert Ant Labs (DistilHuBERT, fp16, 47 MB): one label per 20 ms of raw
// 16 kHz audio. Weights are fetched from Hugging Face at runtime (Desert Ant Labs Source-Available License 1.0:
// never commit or redistribute them) and the UI must show "Powered by Desert Ant Labs" whenever its hits are
// used. Model I/O: "audio" [1, 480000] f32 → "probs" [1, 1499, C]; v1.2 has C = 6 (not_filler, uh, um, hmm,
// and, other), earlier builds C = 5 without "and" (the Desert Ant demo still assumes 5, which garbles v1.2).
// This file is the pure part (windowing + frame labels → hits); the session runs in the ASR worker.
import type { FillerHit } from "../types";

export const UHM_URL = "https://huggingface.co/desert-ant-labs/uhm/resolve/main/uhm-web-fp16.onnx";
export const UHM_WIN = 16000 * 30;
const HOP = 16000 * 25, FRAME = 320, FRAME_S = FRAME / 16000;
/** Class names by class count. Only uh / um / hmm become hits. */
export const UHM_LABELS: Record<number, readonly string[]> = {
  5: ["not_filler", "uh", "um", "hmm", "other"],
  6: ["not_filler", "uh", "um", "hmm", "and", "other"],
};
const KEEP = new Set(["uh", "um", "hmm"]);

/** 30 s windows every 25 s over `len` samples. Each window counts its first 25 s, the last one up to the end. */
export function uhmWindows(len: number): { start: number; last: boolean }[] {
  const out: { start: number; last: boolean }[] = [];
  for (let s = 0; ; s += HOP) {
    const last = s + UHM_WIN >= len;
    out.push({ start: s, last });
    if (last) return out;
  }
}

/** Frames of a window's output (T frames for 30 s) that belong to it. */
export function uhmKeep(T: number, w: { start: number; last: boolean }, len: number): number {
  return w.last ? Math.max(0, Math.min(T, Math.ceil((len - w.start) / FRAME))) : Math.floor((T * 25) / 30);
}

/** Per-frame argmax over C classes of a [T, C] probability block, first `keep` frames. */
export function argmaxFrames(probs: ArrayLike<number>, keep: number, C = 5): { pred: number[]; conf: number[] } {
  const pred: number[] = [], conf: number[] = [];
  for (let t = 0; t < keep; t++) {
    let best = 0, bp = -1;
    for (let c = 0; c < C; c++) {
      const p = probs[t * C + c];
      if (p > bp) { bp = p; best = c; }
    }
    pred.push(best);
    conf.push(bp);
  }
  return { pred, conf };
}

/** Frame labels → filler events: frames ≥ 0.5 ("recall" preset), runs ≥ 120 ms, gaps ≤ 100 ms merged, only uh/um/hmm. */
export function uhmHits(pred: number[], conf: number[], { classes = 6, threshold = 0.5, minSec = 0.12, mergeSec = 0.1 } = {}): FillerHit[] {
  const labels = UHM_LABELS[classes] ?? UHM_LABELS[6];
  const runs: FillerHit[] = [];
  for (let i = 0; i < pred.length; ) {
    if (pred[i] === 0 || conf[i] < threshold) { i++; continue; }
    let j = i, sum = 0;
    const count = new Array<number>(labels.length).fill(0);
    while (j < pred.length && pred[j] !== 0 && conf[j] >= threshold) { count[pred[j]]++; sum += conf[j]; j++; }
    let best = 1;
    for (let c = 2; c < labels.length; c++) if (count[c] > count[best]) best = c;
    const ev: FillerHit = { s: i * FRAME_S, e: j * FRAME_S, label: labels[best] ?? "other", conf: sum / (j - i) };
    const last = runs[runs.length - 1];
    if (last && ev.s - last.e <= mergeSec + 1e-9) {
      last.e = ev.e;
      last.conf = Math.max(last.conf, ev.conf);
    } else runs.push(ev);
    i = j;
  }
  return runs
    .filter((r) => r.e - r.s >= minSec - 1e-9 && KEEP.has(r.label))
    .map((r) => ({ s: round(r.s), e: round(r.e), label: r.label, conf: round(r.conf) }));
}

const round = (x: number) => Math.round(x * 100) / 100;
