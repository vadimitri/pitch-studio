// Whisper word chunks → take-relative words (pure). Whisper's cross-attention timestamps stretch the word
// before a pause into the pause and squash sentence-final words to ~20 ms; the VAD knows where speech
// ends, so the last word before a pause ends where the speech does and no word starts inside silence.
import type { Word } from "../types";
import type { Region } from "./vad";

export interface RawWord { text: string; timestamp: [number, number | null] }

const r2 = (x: number) => Math.round(x * 100) / 100;

function overlap(a: number, b: number, r: Region) {
  return Math.min(b, r.e) - Math.max(a, r.s);
}

/** Index of the region a word belongs to (max overlap, else nearest within `near` s), -1 if none. */
export function regionOf(s: number, e: number, regions: Region[], near = 1): number {
  let best = -1, bestOv = 0;
  for (let i = 0; i < regions.length; i++) {
    const ov = overlap(s, e, regions[i]);
    if (ov > bestOv) { bestOv = ov; best = i; }
  }
  if (best >= 0) return best;
  let bestD = near;
  for (let i = 0; i < regions.length; i++) {
    const d = Math.max(regions[i].s - e, s - regions[i].e);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * @param raw     pipeline `chunks` of one recognised audio chunk (times relative to that chunk)
 * @param offset  chunk start, seconds from take start
 * @param end     chunk end, seconds from take start
 * @param regions VAD speech regions of the chunk (take-relative); empty = no snapping
 */
export function stitchWords(raw: RawWord[], offset: number, end: number, regions: Region[] = []): Word[] {
  const words: (Word & { r: number })[] = [];
  for (const c of raw) {
    const w = c.text.trim();
    if (!w) continue;
    const s = c.timestamp[0] + offset;
    if (!Number.isFinite(s) || s >= end - 0.02) continue; // beyond the audio: Whisper pads to 30 s
    let e = c.timestamp[1] == null || !Number.isFinite(c.timestamp[1]) ? s + 0.2 : c.timestamp[1] + offset;
    e = Math.min(Math.max(e, s + 0.02), end);
    const r = regions.length ? regionOf(s, e, regions) : -2;
    if (r === -1) continue; // far from any speech: hallucinated
    words.push({ w, s, e, r });
  }
  if (regions.length) {
    for (let i = 0; i < words.length; i++) {
      const x = words[i], reg = regions[x.r];
      const firstInRegion = i === 0 || words[i - 1].r !== x.r;
      const lastInRegion = i === words.length - 1 || words[i + 1].r !== x.r;
      const prevEnd = i > 0 ? words[i - 1].e : -Infinity;
      if (firstInRegion && x.s < reg.s) x.s = Math.min(reg.s, x.e - 0.02);
      else if (firstInRegion && x.s - reg.s <= 0.25 && prevEnd <= reg.s) x.s = reg.s; // late start after a pause
      if (lastInRegion && reg.e > x.s + 0.05 && reg.e - x.e < 1.5) x.e = reg.e;
      else if (x.e > reg.e && reg.e > x.s + 0.05) x.e = reg.e;
    }
  }
  // monotonic, non-overlapping
  for (let i = 1; i < words.length; i++) {
    const p = words[i - 1], x = words[i];
    if (x.s < p.s) x.s = p.s;
    if (p.e > x.s) {
      if (x.s - p.s >= 0.01) p.e = x.s;
      else { p.e = p.s + 0.01; x.s = p.e; }
    }
    if (x.e < x.s + 0.01) x.e = x.s + 0.01;
  }
  return words.map(({ w, s, e }) => ({ w, s: r2(s), e: r2(e) }));
}
