import { describe, expect, test } from "vitest";
import type { Timeline, Word } from "../types";
import type { GazeMap } from "../types";
import { LOOK, acousticFillers, classifyLook, classifyMapped, computeMetrics, filterFillerHits, keyMoments, lookOf, mergeFillers, pickFocus, runs } from "./metrics";
import { fillerKind, isFilled, syllables } from "./lexicon";

const HZ = 10;
const calib = { cam: { h: 0, v: 0 }, screen: null, spread: 1, at: 0 };
type Sample = Partial<{ face: number; dH: number | null; dV: number | null; db: number; f0: number; hands: number; motion: number; smile: number }>;
function timeline(sec: number, f: (t: number) => Sample): Timeline {
  const tl: Timeline = { hz: HZ, t: [], face: [], dH: [], dV: [], db: [], f0: [], hands: [], motion: [], smile: [] };
  for (let i = 0; i < sec * HZ; i++) {
    const t = i / HZ;
    const v = { face: 1, dH: 0, dV: 0, smile: 0, hands: 1, motion: 0.1, db: -30, f0: 120 + 30 * Math.sin(t), ...f(t) };
    tl.t.push(t); tl.face.push(v.face); tl.dH.push(v.dH); tl.dV.push(v.dV); tl.db.push(v.db);
    tl.f0.push(v.f0); tl.hands.push(v.hands); tl.motion.push(v.motion); tl.smile.push(v.smile);
  }
  return tl;
}
const words = (text: string, start = 0, rate = 2.5): Word[] =>
  text.split(" ").map((w, i) => ({ w, s: start + i / rate, e: start + i / rate + 0.3 }));

describe("lexicon", () => {
  test("filled pauses incl. punctuation", () => {
    expect(isFilled("Äh,")).toBe(true);
    expect(isFilled("ähm")).toBe(true);
    expect(isFilled("Um.")).toBe(true);
    expect(isFilled("also")).toBe(false);
  });
  test("German words that are English fillers are not fillers in German", () => {
    expect(isFilled("er", "de")).toBe(false);
    expect(isFilled("um", "de")).toBe(false);
    expect(isFilled("eh", "de")).toBe(false);
    expect(isFilled("äh", "de")).toBe(true);
    expect(isFilled("um", "en")).toBe(true);
    expect(isFilled("er,", "en")).toBe(true);
  });
  test("filler kinds", () => {
    expect(fillerKind("äh")).toBe("uh");
    expect(fillerKind("Ähm,")).toBe("um");
    expect(fillerKind("uhm")).toBe("um");
    expect(fillerKind("hmm")).toBe("hm");
  });
  test("syllables", () => {
    expect(syllables("Telefonzelle")).toBe(5);
    expect(syllables("Präsentation")).toBe(4);
    expect(syllables("Sache")).toBe(2);
    expect(syllables("make", "en")).toBe(1);
    expect(syllables("Eins")).toBe(1);
  });
});

describe("gaze", () => {
  test("classify", () => {
    expect(classifyLook(2, 3, null)).toBe(LOOK.CAMERA);
    expect(classifyLook(30, 5, { h: 30, v: 8 })).toBe(LOOK.SCREEN);
    expect(classifyLook(0, 25, null)).toBe(LOOK.DOWN);
    expect(classifyLook(-40, 0, null)).toBe(LOOK.AWAY);
    expect(classifyLook(null, 0, null)).toBe(LOOK.NONE);
  });
  // laptop-like map: 1440×900 viewport, 40 px per degree, lens (raw v = -8°) 4° above the top edge, screen centre 15° below it
  const map: GazeMap = { a: [720, -40, 0, 160, 0, 40], lens: { x: 720, y: -160 }, r: 220, vw: 1440, vh: 900, rms: 10 };
  test("gaze map: lens zone, screen, below, above", () => {
    expect(classifyMapped(0, -8, map)).toBe(LOOK.CAMERA); // into the lens
    expect(classifyMapped(1, -5, map)).toBe(LOOK.CAMERA); // just under it
    expect(classifyMapped(0, 7, map)).toBe(LOOK.SCREEN); // screen centre
    expect(classifyMapped(15, 2, map)).toBe(LOOK.SCREEN); // left part of the screen
    expect(classifyMapped(0, 25, map)).toBe(LOOK.DOWN); // keyboard, notes
    expect(classifyMapped(0, -15, map)).toBe(LOOK.AWAY); // a monitor above the laptop
    expect(classifyMapped(30, -4, map)).toBe(LOOK.AWAY); // to the side
  });
  test("gaze map: hysteresis margin keeps the current class at the border", () => {
    expect(classifyMapped(0, -13.6, map)).toBe(LOOK.AWAY); // 224 px above the lens point
    expect(classifyMapped(0, -13.6, map, LOOK.CAMERA, 30)).toBe(LOOK.CAMERA);
  });
  test("timeline samples use the map when the take has one", () => {
    const calib = { cam: { h: 0, v: -8 }, screen: null, spread: 1, at: 0, map };
    expect(lookOf(0, -7, calib)).toBe(LOOK.AWAY); // 7° above the lens: the monitor above
    expect(lookOf(0, -7, { ...calib, map: null })).toBe(LOOK.CAMERA); // the old 9° circle counted it as lens
    expect(lookOf(0, 3, calib)).toBe(LOOK.CAMERA);
  });
  test("runs merges small gaps and filters short ones", () => {
    const on = [0, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1];
    expect(runs(on.length, 10, (i) => on[i] === 1, { mergeGap: 0.15 })).toEqual([{ s: 0.1, e: 0.7 }, { s: 1.3, e: 1.4 }]);
    expect(runs(on.length, 10, (i) => on[i] === 1, { mergeGap: 0.15, minDur: 0.5 })).toEqual([{ s: 0.1, e: 0.7 }]);
  });
  test("percentages and looking-down segment", () => {
    const tl = timeline(30, (t) => (t >= 10 && t < 16 ? { dV: 25 } : {}));
    const m = computeMetrics({ timeline: tl, durationSec: 30, targetSec: 30, calib });
    expect(m.gaze.downPct).toBe(20);
    expect(m.gaze.cameraPct).toBe(80);
    expect(m.gaze.downSegments).toEqual([{ s: 10, e: 16 }]);
    expect(m.gaze.longestAway?.dur).toBe(6);
  });
  test("frames without a face do not count as looking away", () => {
    const tl = timeline(20, (t) => (t < 10 ? { face: 0, dH: null, dV: null } : {}));
    const m = computeMetrics({ timeline: tl, durationSec: 20, targetSec: 20, calib });
    expect(m.gaze.facePct).toBe(50);
    expect(m.gaze.cameraPct).toBe(100);
    expect(m.gaze.longestAway).toBeNull();
  });
});

describe("speech", () => {
  const text = "Hallo ich bin äh Kim und ähm ich zeige euch heute. unser Projekt";
  const tl = timeline(60, () => ({}));
  const w = words(text);
  for (const k of [w.length - 2, w.length - 1]) { w[k].s += 2; w[k].e += 2; } // pause after "heute."
  const m = computeMetrics({ timeline: tl, durationSec: 60, targetSec: 60, words: w, lang: "de" });
  test("fillers from the transcript are measured, not estimated", () => {
    expect(m.speech!.fillers.count).toBe(2);
    expect(m.speech!.fillers.items.map((f) => f.kind)).toEqual(["uh", "um"]);
    expect(m.speech!.fillers.estimated).toBe(false);
  });
  test("pause after sentence end is a sentence pause", () => {
    expect(m.speech!.pauses).toHaveLength(1);
    expect(m.speech!.pauses[0].kind).toBe("sentence");
  });
  test("no transcript -> speech null, still gaze/voice", () => {
    const m2 = computeMetrics({ timeline: tl, durationSec: 60, targetSec: 60 });
    expect(m2.speech).toBeNull();
    expect(m2.voice.spreadSt).toBeGreaterThan(0);
  });
});

describe("voice", () => {
  test("flat pitch is monotone", () => {
    const tl = timeline(40, (t) => ({ f0: t < 20 ? 120 + 40 * Math.sin(t * 2) : 120 }));
    const m = computeMetrics({ timeline: tl, durationSec: 40, targetSec: 40 });
    expect(m.voice.monotone.length).toBeGreaterThan(0);
    expect(m.voice.monotone[0].s).toBeGreaterThanOrEqual(12);
  });
});

describe("acoustic fillers", () => {
  const tl = timeline(30, (t) => {
    if (t >= 10 && t < 10.6) return { f0: 110, db: -30 };
    if (t >= 20 && t < 20.6) return { f0: 120, db: -30 };
    if ((t >= 9.6 && t < 10) || (t >= 10.6 && t < 11) || (t >= 19.6 && t < 20) || (t >= 20.6 && t < 21)) return { f0: 0 };
    return { f0: 120 + 40 * Math.sin(t * 7) };
  });
  const w = [{ w: "Also", s: 9, e: 9.5 }, { w: "ihr", s: 10.05, e: 10.5 }, { w: "Projekt", s: 11.2, e: 11.8 }, { w: "Sooo", s: 19.9, e: 20.7 }];
  test("flat voiced stretch inside a filler-like word counts, inside a real word not", () => {
    expect(acousticFillers(tl, w).map((x) => Math.round(x.t))).toEqual([10]);
  });
  test("estimated fillers are flagged and never auto-picked as focus", () => {
    const m = computeMetrics({ timeline: tl, durationSec: 30, targetSec: 30, words: w, fillerMode: "acoustic" });
    expect(m.speech!.fillers.estimated).toBe(true);
    expect(m.speech!.fillers.count).toBe(1);
    expect(pickFocus(m, null, null).key).not.toBe("fillers");
  });
});

describe("detector fillers", () => {
  const ws = [{ w: "Wir", s: 1, e: 1.3 }, { w: "bauen", s: 1.3, e: 1.8 }, { w: "ihr", s: 2.0, e: 2.4 }, { w: "Roboter", s: 3, e: 3.6 }];
  test("hits inside real words are dropped, inside filler-like words or gaps kept", () => {
    const hits = [{ s: 1.35, e: 1.7, label: "uh", conf: 0.9 }, { s: 2.0, e: 2.4, label: "um", conf: 0.9 }, { s: 2.5, e: 2.9, label: "uh", conf: 0.9 }];
    expect(filterFillerHits(hits, ws).map((h) => h.s)).toEqual([2.0, 2.5]);
  });
  test("merge does not double count a filler the transcript already has", () => {
    const w2 = [{ w: "so", s: 0, e: 0.3 }, { w: "äh", s: 0.5, e: 0.8 }, { w: "yes", s: 1.2, e: 1.5 }];
    const merged = mergeFillers(w2, [{ s: 0.55, e: 0.8, label: "uh", conf: 0.9 }, { s: 2, e: 2.4, label: "um", conf: 0.8 }]);
    expect(merged.map((f) => [f.t, f.src])).toEqual([[0.5, "asr"], [2, "detector"]]);
  });
  test("detector mode is flagged as estimate", () => {
    const m = computeMetrics({ timeline: timeline(10, () => ({})), durationSec: 10, targetSec: 10, words: ws,
      fillerMode: "detector", fillerHits: [{ s: 2.5, e: 2.9, label: "um", conf: 0.8 }] });
    expect(m.speech!.fillers).toMatchObject({ count: 1, estimated: true });
    expect(m.speech!.fillers.items[0].kind).toBe("um");
  });
});

describe("focus", () => {
  test("worst dimension wins, chosen focus overrides, delta vs prev", () => {
    const tl = timeline(60, (t) => (t < 30 ? { dV: 25 } : {}));
    const m = computeMetrics({ timeline: tl, durationSec: 90, targetSec: 60, calib });
    expect(pickFocus(m, null, null).key).toBe("time");
    expect(pickFocus(m, null, "gaze").key).toBe("gaze");
    const prev = computeMetrics({ timeline: timeline(60, () => ({ dV: 25 })), durationSec: 60, targetSec: 60, calib });
    expect(pickFocus(m, prev, "gaze").prev).toBe(0);
  });
  test("key moments are sorted and start at 0", () => {
    const m = computeMetrics({ timeline: timeline(40, () => ({})), durationSec: 40, targetSec: 40, calib });
    const km = keyMoments(m);
    expect(km[0]).toEqual({ key: "start", t: 0 });
    expect(km.map((k) => k.t)).toEqual([...km.map((k) => k.t)].sort((a, b) => a - b));
  });
});
