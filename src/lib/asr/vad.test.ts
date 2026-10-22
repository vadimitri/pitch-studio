import { describe, expect, it } from "vitest";
import { Chunker, FRAME, SR, mergeChunks, speechRegions } from "./vad";

/** Synthetic take: tone bursts ("speech") separated by silence, as [kind, seconds][] */
function synth(parts: [("s" | "-"), number][]) {
  const n = Math.round(parts.reduce((a, [, d]) => a + d, 0) * SR);
  const pcm = new Float32Array(n);
  let o = 0;
  for (const [k, d] of parts) {
    const m = Math.round(d * SR);
    if (k === "s") for (let i = 0; i < m; i++) pcm[o + i] = 0.1 * Math.sin((2 * Math.PI * 180 * (o + i)) / SR);
    else for (let i = 0; i < m; i++) pcm[o + i] = (Math.random() * 2 - 1) * 1e-4;
    o += m;
  }
  return pcm;
}

/** Feeds the take in 250 ms pieces like the capture worklet does. */
function feed(pcm: Float32Array, c = new Chunker()) {
  const out = [];
  for (let len = 4000; len < pcm.length + 4000; len += 4000) out.push(...c.advance(pcm, Math.min(len, pcm.length)));
  out.push(...c.flush(pcm));
  return out;
}

describe("speechRegions", () => {
  it("bridges short gaps, drops blips, adds hangover", () => {
    const sp = [0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, ...Array(12).fill(0), 1, 0, 0, 1, 1, 1, 1, 0];
    const r = speechRegions(sp, 0, sp.length);
    expect(r).toEqual([
      { s: 0.02, e: 0.28 }, // 1..11 incl. 3-frame gap, +2 frames
      { s: 0.48, e: 0.64 }, // frame 24 + 27..30: gap of 2 bridged, hangover clamped to the end
    ]);
  });
});

describe("Chunker", () => {
  it("cuts at the first pause >= 250 ms after 8 s", () => {
    const pcm = synth([["-", 0.5], ["s", 5], ["-", 0.3], ["s", 4], ["-", 0.4], ["s", 3], ["-", 0.5]]);
    const chunks = feed(pcm);
    expect(chunks.length).toBe(2);
    // first cut lies inside the 0.4 s pause that starts at 9.8 s
    const cut = chunks[0].s1 / SR;
    expect(cut).toBeGreaterThan(9.8);
    expect(cut).toBeLessThan(10.2);
    expect(chunks[1].s0).toBe(chunks[0].s1);
    expect(chunks[1].s1).toBe(pcm.length);
    expect(chunks[0].speechSec).toBeCloseTo(9, 0);
  });

  it("does not cut on pauses before 8 s", () => {
    const pcm = synth([["s", 2], ["-", 0.5], ["s", 2], ["-", 0.5], ["s", 2]]);
    const chunks = feed(pcm);
    expect(chunks.length).toBe(1);
    expect(chunks[0].regions.length).toBe(3);
  });

  it("force-cuts by 20 s in the quietest spot, not mid-tone", () => {
    // 22 s of speech with only short 100 ms dips
    const parts: [("s" | "-"), number][] = [];
    for (let i = 0; i < 11; i++) parts.push(["s", 1.9], ["-", 0.1]);
    const pcm = synth(parts);
    const chunks = feed(pcm);
    expect(chunks.length).toBe(2);
    const cut = chunks[0].s1 / SR;
    expect(cut).toBeLessThanOrEqual(20);
    expect(cut).toBeGreaterThan(14);
    // cut inside one of the dips (each dip ends at k*2.0 s)
    const inDip = Math.abs(cut - Math.round(cut / 2) * 2) <= 0.1;
    expect(inDip).toBe(true);
  });

  it("chunks are contiguous and cover the take", () => {
    const pcm = synth([["-", 1], ["s", 9], ["-", 0.6], ["s", 12], ["-", 0.3], ["s", 25], ["-", 1]]);
    const chunks = feed(pcm);
    expect(chunks[0].s0).toBe(0);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].s0).toBe(chunks[i - 1].s1);
    expect(chunks.at(-1)!.s1).toBe(pcm.length);
    for (const c of chunks) expect(c.s1 - c.s0).toBeLessThanOrEqual(20 * SR);
    expect(chunks.every((c) => c.s0 % FRAME === 0)).toBe(true);
  });

  it("silence-only takes have no speech", () => {
    const chunks = feed(synth([["-", 12]]));
    expect(chunks.reduce((a, c) => a + c.speechSec, 0)).toBe(0);
  });
});

describe("mergeChunks", () => {
  it("joins contiguous chunks up to 29 s", () => {
    const ch = (a: number, b: number) => ({ s0: a * SR, s1: b * SR, regions: [{ s: a, e: b }], speechSec: b - a });
    const m = mergeChunks([ch(0, 10), ch(10, 20), ch(20, 31), ch(31, 40), ch(40, 45)]);
    expect(m.map((c) => [c.s0 / SR, c.s1 / SR])).toEqual([[0, 20], [20, 45]]);
    expect(m[1].regions.length).toBe(3);
    expect(m[1].speechSec).toBe(25);
  });
});
