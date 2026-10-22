import { describe, expect, it } from "vitest";
import { argmaxFrames, uhmHits, uhmKeep, uhmWindows } from "./uhm";

describe("uhm windows", () => {
  it("30 s windows every 25 s, the last one counts to the end", () => {
    expect(uhmWindows(16000 * 10)).toEqual([{ start: 0, last: true }]);
    const w = uhmWindows(16000 * 70);
    expect(w.map((x) => x.start / 16000)).toEqual([0, 25, 50]);
    expect(w.map((x) => x.last)).toEqual([false, false, true]);
    expect(uhmKeep(1500, w[0], 16000 * 70)).toBe(1250);
    expect(uhmKeep(1500, w[2], 16000 * 70)).toBe(1000);
    // frames counted = whole take
    const total = w.reduce((a, x) => a + uhmKeep(1500, x, 16000 * 70), 0);
    expect(total).toBe(3500);
  });
});

describe("uhmHits", () => {
  // 20 ms frames
  const frames = (spec: [number, number, number][]) => {
    const pred: number[] = [], conf: number[] = [];
    for (const [label, p, n] of spec) for (let i = 0; i < n; i++) { pred.push(label); conf.push(p); }
    return { pred, conf };
  };

  it("finds runs >= 120 ms over threshold", () => {
    const { pred, conf } = frames([[0, 0.9, 50], [1, 0.8, 10], [0, 0.9, 50], [2, 0.7, 5], [0, 0.9, 10]]);
    expect(uhmHits(pred, conf)).toEqual([{ s: 1, e: 1.2, label: "uh", conf: 0.8 }]);
  });

  it("merges gaps <= 100 ms and takes the majority label", () => {
    const { pred, conf } = frames([[2, 0.9, 4], [0, 0.9, 5], [2, 0.6, 6], [1, 0.6, 2]]);
    const h = uhmHits(pred, conf);
    expect(h.length).toBe(1);
    expect(h[0]).toMatchObject({ s: 0, e: 0.34, label: "um" });
  });

  it("ignores low-confidence and 'other' frames", () => {
    const { pred, conf } = frames([[1, 0.4, 20], [0, 0.9, 10], [5, 0.9, 20], [0, 0.9, 10], [4, 0.9, 20], [3, 0.9, 3]]);
    expect(uhmHits(pred, conf)).toEqual([]); // low conf, "other", "and", too short
    const old = frames([[4, 0.9, 20]]);
    expect(uhmHits(old.pred, old.conf, { classes: 5 })).toEqual([]); // 5-class build: 4 = other
    const b = frames([[0, 0.9, 10], [3, 0.95, 8]]);
    expect(uhmHits(b.pred, b.conf)).toEqual([{ s: 0.2, e: 0.36, label: "hmm", conf: 0.95 }]);
  });
});

describe("argmaxFrames", () => {
  it("argmax per frame", () => {
    const p = [0.9, 0.1, 0, 0, 0, 0.1, 0.2, 0.7, 0, 0];
    expect(argmaxFrames(p, 2)).toEqual({ pred: [0, 2], conf: [0.9, 0.7] });
  });
});
