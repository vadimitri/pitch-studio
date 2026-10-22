import { describe, expect, it } from "vitest";
import { regionOf, stitchWords, type RawWord } from "./stitch";

const raw = (text: string, s: number, e: number | null): RawWord => ({ text, timestamp: [s, e] });

describe("stitchWords", () => {
  it("adds the chunk offset and trims", () => {
    const w = stitchWords([raw(" Hallo", 0.3, 0.7), raw(" zusammen,", 0.7, 1.1)], 10, 20);
    expect(w).toEqual([{ w: "Hallo", s: 10.3, e: 10.7 }, { w: "zusammen,", s: 10.7, e: 11.1 }]);
  });

  it("drops words past the chunk end (Whisper pads to 30 s) and clamps ends", () => {
    const w = stitchWords([raw(" ok", 1, 12), raw(" Amen.", 28.9, 30)], 0, 8);
    expect(w).toEqual([{ w: "ok", s: 1, e: 8 }]);
  });

  it("snaps the word before a pause to the speech end (stretched and squashed)", () => {
    const regions = [{ s: 0.2, e: 2.0 }, { s: 3.0, e: 5.0 }];
    const w = stitchWords([
      raw(" Projekt", 0.2, 1.5), raw(" vorstellen.", 1.5, 2.9), // stretched into the pause
      raw(" Also", 3.1, 3.6), raw(" gut.", 4.3, 4.32), // squashed sentence end
    ], 0, 6, regions);
    expect(w[1]).toEqual({ w: "vorstellen.", s: 1.5, e: 2 });
    expect(w[3]).toEqual({ w: "gut.", s: 4.3, e: 5 });
  });

  it("no word starts inside silence before its region", () => {
    const w = stitchWords([raw(" Also", 2.6, 3.4)], 0, 6, [{ s: 0, e: 1 }, { s: 3, e: 4 }]);
    expect(w[0].s).toBe(3);
  });

  it("drops words far from any speech", () => {
    const w = stitchWords([raw(" ja", 0.5, 0.8), raw(" Untertitel", 6, 7)], 0, 8, [{ s: 0.4, e: 1 }]);
    expect(w.map((x) => x.w)).toEqual(["ja"]);
  });

  it("keeps words monotonic and non-overlapping", () => {
    const w = stitchWords([raw(" a", 1, 1.5), raw(" b", 1.2, 1.3), raw(" c", 1.2, 1.2)], 0, 5);
    for (let i = 1; i < w.length; i++) {
      expect(w[i].s).toBeGreaterThanOrEqual(w[i - 1].e);
      expect(w[i].e).toBeGreaterThan(w[i].s);
    }
  });

  it("handles a missing end timestamp", () => {
    const w = stitchWords([raw(" x", 1, null)], 0, 5);
    expect(w[0]).toEqual({ w: "x", s: 1, e: 1.2 });
  });
});

describe("regionOf", () => {
  it("max overlap, else nearest within 1 s", () => {
    const r = [{ s: 0, e: 1 }, { s: 2, e: 3 }];
    expect(regionOf(0.8, 2.5, r)).toBe(1);
    expect(regionOf(1.3, 1.5, r)).toBe(0);
    expect(regionOf(4.5, 5, r)).toBe(-1);
  });
});
