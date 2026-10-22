// Energy VAD + chunker for incremental recognition (pure, runs in the ASR worker). 20 ms frames at 16 kHz.
// Cuts at the first pause >= 250 ms once a chunk is >= 8 s long; at 20 s it force-cuts at the quietest spot
// of the last seconds so a word is not split. Chunks never overlap: word time = chunk time + chunk offset.

export const SR = 16000;
export const FRAME = 320; // 20 ms
const FS = FRAME / SR;

export interface Region { s: number; e: number } // seconds from take start

export interface Chunk {
  s0: number; // first sample (take-relative)
  s1: number; // end sample (exclusive)
  /** Speech regions inside the chunk, seconds from take start. */
  regions: Region[];
  speechSec: number;
}

export interface ChunkerOptions {
  minSec: number;
  maxSec: number;
  pauseSec: number;
  /** Search window before the force cut. */
  searchSec: number;
}

export const CHUNKER_DEFAULTS: ChunkerOptions = { minSec: 8, maxSec: 20, pauseSec: 0.25, searchSec: 6 };

const FLOOR_MIN = -80, FLOOR_MAX = -35, FLOOR_RISE = 0.3 * FS; // dB per frame (0.3 dB/s)
const ABOVE_FLOOR = 12, ABS_MIN = -52; // speech = level > max(floor + 12, -52 dBFS)

export function frameDb(pcm: Float32Array, from: number, n = FRAME): number {
  let e = 0;
  const end = Math.min(pcm.length, from + n);
  for (let i = from; i < end; i++) e += pcm[i] * pcm[i];
  return 10 * Math.log10(e / Math.max(1, end - from) + 1e-10);
}

/** Speech regions from per-frame flags in [f0, f1): gaps < 160 ms bridged (stop closures), blips < 60 ms dropped,
 *  40 ms hangover. */
export function speechRegions(sp: ArrayLike<number | boolean>, f0: number, f1: number): Region[] {
  const out: Region[] = [];
  let start = -1, lastOn = -1;
  for (let f = f0; f <= f1; f++) {
    const on = f < f1 && !!sp[f];
    if (on) {
      if (start < 0) start = f;
      else if (f - lastOn - 1 >= 8) { push(start, lastOn + 1); start = f; }
      lastOn = f;
    }
  }
  if (start >= 0) push(start, lastOn + 1);
  return out;
  function push(a: number, b: number) {
    if (b - a < 3) return;
    out.push({ s: round2(a * FS), e: round2(Math.min(f1, b + 2) * FS) });
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export class Chunker {
  private db: number[] = [];
  private sp: number[] = [];
  private floor = -60;
  private start = 0; // first frame of the open chunk
  private silRun = 0;
  private readonly o: ChunkerOptions;

  constructor(opts: Partial<ChunkerOptions> = {}) {
    this.o = { ...CHUNKER_DEFAULTS, ...opts };
  }

  get frames() { return this.db.length; }

  /** Consumes all complete frames of pcm[0, len) not seen yet; returns the chunks that closed. */
  advance(pcm: Float32Array, len = pcm.length): Chunk[] {
    const out: Chunk[] = [];
    const minF = Math.round(this.o.minSec / FS), maxF = Math.round(this.o.maxSec / FS), pauseF = Math.ceil(this.o.pauseSec / FS);
    while ((this.db.length + 1) * FRAME <= len) {
      const f = this.db.length;
      const d = frameDb(pcm, f * FRAME);
      this.floor = d < this.floor ? Math.max(d, FLOOR_MIN) : Math.min(this.floor + FLOOR_RISE, FLOOR_MAX);
      const on = d > Math.max(this.floor + ABOVE_FLOOR, ABS_MIN) ? 1 : 0;
      this.db.push(d);
      this.sp.push(on);
      this.silRun = on ? 0 : this.silRun + 1;
      const n = f + 1 - this.start;
      if (n >= minF && this.silRun >= pauseF) out.push(this.close(f + 1));
      else if (n >= maxF) out.push(this.close(this.bestCut(f + 1)));
    }
    return out;
  }

  /** Closes the open chunk at the end of the take (includes a partial last frame). */
  flush(pcm: Float32Array, len = pcm.length): Chunk[] {
    const out = this.advance(pcm, len);
    const f1 = this.db.length;
    if (len > this.start * FRAME) {
      const c = this.close(f1);
      c.s1 = len;
      out.push(c);
    }
    return out;
  }

  private close(fCut: number): Chunk {
    const f0 = this.start;
    let speech = 0;
    for (let f = f0; f < fCut; f++) speech += this.sp[f];
    this.start = fCut;
    return { s0: f0 * FRAME, s1: fCut * FRAME, regions: speechRegions(this.sp, f0, fCut), speechSec: round2(speech * FS) };
  }

  /** Force cut: middle of the longest silence in the search window, else the quietest 60 ms. */
  private bestCut(fEnd: number): number {
    const a = Math.max(this.start + 1, fEnd - Math.round(this.o.searchSec / FS)), b = fEnd - 1;
    let bestLen = 0, bestMid = -1, run = 0;
    for (let f = a; f <= b; f++) {
      run = this.sp[f] ? 0 : run + 1;
      if (run >= 3 && run >= bestLen) { bestLen = run; bestMid = f - Math.floor(run / 2); }
    }
    if (bestMid > 0) return bestMid;
    let minE = Infinity, at = fEnd;
    for (let f = a + 1; f < b; f++) {
      const e = this.db[f - 1] + this.db[f] + this.db[f + 1];
      if (e < minE) { minE = e; at = f; }
    }
    return at;
  }
}

/**
 * Joins consecutive chunks into groups of at most `maxSec`. For the WASM fallback, which transcribes after
 * stop: Whisper's encoder always runs a full 30 s window, so fewer, longer chunks are much cheaper.
 */
export function mergeChunks(chunks: Chunk[], maxSec = 29): Chunk[] {
  const out: Chunk[] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if (last && last.s1 === c.s0 && (c.s1 - last.s0) / SR <= maxSec) {
      out[out.length - 1] = {
        s0: last.s0, s1: c.s1, regions: [...last.regions, ...c.regions],
        speechSec: Math.round((last.speechSec + c.speechSec) * 100) / 100,
      };
    } else out.push({ ...c });
  }
  return out;
}
