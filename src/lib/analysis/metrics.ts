// Pure take analysis. Input timeline is columnar at `hz` samples/s; gaze angles in degrees relative to
// the calibrated lens direction (dH > 0 = image right, dV > 0 = down). Everything here describes behaviour
// with ranges from studies (RESEARCH.md), never a grade of the person.
import type { Calibration, FillerHit, FocusId, GazeMap, SpeechLang, Timeline, Word } from "../types";
import { FILLER_LIKE, fillerKind, isFilled, norm, softList, syllables } from "./lexicon";

export const LOOK = { NONE: 0, CAMERA: 1, SCREEN: 2, DOWN: 3, AWAY: 4 } as const;
export type Look = (typeof LOOK)[keyof typeof LOOK];
/** Thresholds (deg) for the fallback rule when the dot calibration failed. Unvalidated estimates: change only after the
 *  10-person check. With a gaze map (classifyMapped) the zones come from the person's own dots instead. */
export const GAZE = { cameraDeg: 9, screenDeg: 12, downDeg: 15 };
/** Lens zone radius as a share of the lens–screen-centre distance: on a 14" laptop at 55 cm that is ≈ 4–5°, the range
 *  in which people still perceive eye contact (Gamer & Hecht 2007). The screen's top strip right under the lens counts. */
export const MAP = { lensShare: 0.35, maxShare: 0.6, edgeShare: 0.04 };
export const BANDS = { fillersPerMin: 5, sylPerSec: [2.4, 4.6] as [number, number], wpm: [100, 165], durationTol: 0.15 };

export interface Span { s: number; e: number }
export interface FillerItem { t: number; kind: "uh" | "um" | "hm"; src: "asr" | "detector" | "acoustic" }
export interface Pause { s: number; e: number; dur: number; kind: "sentence" | "hesitation" | "hang" }

export interface Metrics {
  duration: { sec: number; target: number; ratio: number | null };
  gaze: {
    facePct: number; cameraPct: number; screenPct: number; downPct: number; awayPct: number;
    downSegments: Span[]; longestAway: (Span & { dur: number }) | null; calibrated: boolean;
  };
  voice: { voicedPct: number; medianHz: number | null; spreadSt: number | null; monotone: Span[] };
  speech: null | {
    words: number; wpm: number; sylPerSec: number;
    pace: { t: number; sylPerSec: number }[];
    fillers: { count: number; perMin: number; items: FillerItem[]; estimated: boolean };
    soft: { w: string; count: number }[];
    pauses: Pause[];
    hesitationsPerMin: number;
  };
  body: null | { handsVisiblePct: number; gestureActivity: number; smilePct: number };
  look: Look[];
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
export const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function classifyLook(dH: number | null, dV: number | null, screen: Calibration["screen"], radius = GAZE.cameraDeg): Look {
  if (dH == null || dV == null || Number.isNaN(dH)) return LOOK.NONE;
  const dc = Math.hypot(dH, dV);
  const ds = screen ? Math.hypot(dH - screen.h, dV - screen.v) : Infinity;
  if (dc <= radius && dc <= ds) return LOOK.CAMERA;
  if (ds <= GAZE.screenDeg) return LOOK.SCREEN;
  if (dV >= GAZE.downDeg) return LOOK.DOWN;
  return LOOK.AWAY;
}

export const mapGaze = (m: GazeMap, h: number, v: number) => ({ x: m.a[0] + m.a[1] * h + m.a[2] * v, y: m.a[3] + m.a[4] * h + m.a[5] * v });

/** Look class from the person's gaze map: the lens zone (circle around where the lens sample lands), the viewport,
 *  below it, else away (a monitor above the laptop, the window, the room). `hold` + `margin` (px) widen the current
 *  class for the live hysteresis. */
export function classifyMapped(h: number, v: number, m: GazeMap, hold: Look = LOOK.NONE, margin = 0): Look {
  const p = mapGaze(m, h, v);
  const w = (k: Look) => (hold === k ? margin : -margin);
  if (Math.hypot(p.x - m.lens.x, p.y - m.lens.y) <= m.r + w(LOOK.CAMERA)) return LOOK.CAMERA;
  const e = MAP.edgeShare * Math.min(m.vw, m.vh) + w(LOOK.SCREEN);
  if (p.x >= -e && p.x <= m.vw + e && p.y >= -e && p.y <= m.vh + e) return LOOK.SCREEN;
  if (p.y > m.vh && p.x >= -0.3 * m.vw && p.x <= 1.3 * m.vw) return LOOK.DOWN;
  return LOOK.AWAY;
}

/** Class of one timeline sample (rel = relative to the lens sample) with whatever calibration the take has. */
export function lookOf(dH: number | null, dV: number | null, calib: Calibration | null): Look {
  if (dH == null || dV == null || Number.isNaN(dH)) return LOOK.NONE;
  if (calib?.map) return classifyMapped(calib.cam.h + dH, calib.cam.v + dV, calib.map);
  return classifyLook(dH, dV, calib?.screen ?? null, calib?.radius ?? GAZE.cameraDeg);
}

/** Runs of samples where pred(i) holds, as spans in seconds. Gaps <= mergeGap are bridged. */
export function runs(n: number, hz: number, pred: (i: number) => boolean, { minDur = 0, mergeGap = 0.5 } = {}): Span[] {
  const out: Span[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pred(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const seg = { s: start / hz, e: i / hz };
      const last = out[out.length - 1];
      if (last && seg.s - last.e <= mergeGap) last.e = seg.e;
      else out.push(seg);
      start = -1;
    }
  }
  return out.filter((r) => r.e - r.s >= minDur).map((r) => ({ s: round(r.s, 2), e: round(r.e, 2) }));
}

function gazeMetrics(tl: Timeline, calib: Calibration | null) {
  const n = tl.t.length;
  const look: Look[] = Array.from({ length: n }, (_, i) => (tl.face[i] ? lookOf(tl.dH[i], tl.dV[i], calib) : LOOK.NONE));
  const faceN = look.filter((l) => l !== LOOK.NONE).length;
  const pct = (k: Look) => (faceN ? round((100 * look.filter((l) => l === k).length) / faceN, 0) : 0);
  const away = runs(n, tl.hz, (i) => look[i] !== LOOK.CAMERA && look[i] !== LOOK.NONE, { mergeGap: 0.3 });
  const longest = away.reduce<Span | null>((b, r) => (r.e - r.s > (b ? b.e - b.s : 0) ? r : b), null);
  return {
    look,
    out: {
      facePct: n ? round((100 * faceN) / n, 0) : 0,
      cameraPct: pct(LOOK.CAMERA),
      screenPct: pct(LOOK.SCREEN),
      downPct: pct(LOOK.DOWN),
      awayPct: pct(LOOK.AWAY),
      downSegments: runs(n, tl.hz, (i) => look[i] === LOOK.DOWN, { minDur: 2 }),
      longestAway: longest ? { ...longest, dur: round(longest.e - longest.s) } : null,
      calibrated: !!calib,
    },
  };
}

function voiceMetrics(tl: Timeline): Metrics["voice"] {
  const n = tl.t.length;
  const f0 = tl.f0.filter((x) => x > 0);
  if (f0.length < tl.hz * 3) return { voicedPct: round((100 * f0.length) / Math.max(1, n), 0), medianHz: null, spreadSt: null, monotone: [] };
  const med = median(f0);
  const st = (x: number) => 12 * Math.log2(x / med);
  const spread = std(f0.map(st));
  const win = 8 * tl.hz, step = 2 * tl.hz;
  const flat = new Uint8Array(n);
  for (let a = 0; a + win <= n; a += step) {
    const v: number[] = [];
    for (let i = a; i < a + win; i++) if (tl.f0[i] > 0) v.push(st(tl.f0[i]));
    if (v.length >= 0.3 * win && std(v) < Math.max(1.0, 0.5 * spread)) flat.fill(1, a, a + win);
  }
  return {
    voicedPct: round((100 * f0.length) / n, 0),
    medianHz: round(med, 0),
    spreadSt: round(spread),
    monotone: runs(n, tl.hz, (i) => flat[i] === 1, { minDur: 8 }),
  };
}

/** Filled pauses from the voice (Goto et al. 1999): ≥0.4 s voiced, flat pitch, steady level, and not inside a
 *  recognised normal word. Fallback for recognisers that drop "äh". */
export function acousticFillers(tl: Timeline, words: Word[] = []): FillerItem[] {
  const out: FillerItem[] = [], n = tl.t.length, hz = tl.hz;
  const st = (f: number) => 12 * Math.log2(f / 100);
  let k = 0;
  while (k < n) {
    if (!(tl.f0[k] > 0)) { k++; continue; }
    let m = k + 1;
    while (m < n && tl.f0[m] > 0 && Math.abs(st(tl.f0[m]) - st(tl.f0[m - 1])) < 0.6
      && Math.abs(st(tl.f0[m]) - st(tl.f0[k])) < 1.0 && Math.abs(tl.db[m] - tl.db[k]) < 5) m++;
    const s = k / hz, e = m / hz;
    if (m - k >= 0.4 * hz && m - k <= 1.6 * hz) {
      const inside = words.filter((w) => w.s < e - 0.05 && w.e > s + 0.05);
      if (inside.every((w) => FILLER_LIKE.has(norm(w.w)))) {
        const last = out[out.length - 1];
        if (!last || s - last.t > 0.5) out.push({ t: round(s, 2), kind: "uh", src: "acoustic" });
      }
    }
    k = m;
  }
  return out;
}

/** Detector hits minus those inside a recognised normal word: the transcript is the better judge there
 *  (ASR-confirmed candidates raised filler F1 from 71 to 93 in Zhu et al. 2022). */
export function filterFillerHits(hits: FillerHit[], words: Word[] = []): FillerHit[] {
  return hits.filter((h) => {
    const len = h.e - h.s;
    return !words.some((w) => !FILLER_LIKE.has(norm(w.w)) && Math.min(h.e, w.e) - Math.max(h.s, w.s) > 0.5 * len);
  });
}

/** Union of fillers written in the transcript and detector hits that are not already there. */
export function mergeFillers(words: Word[], hits: FillerHit[] | null, lang?: SpeechLang): FillerItem[] {
  const fromAsr: FillerItem[] = words.filter((w) => isFilled(w.w, lang)).map((w) => ({ t: round(w.s, 2), kind: fillerKind(w.w), src: "asr" }));
  const fromDet: FillerItem[] = filterFillerHits(hits ?? [], words)
    .filter((h) => !fromAsr.some((f) => Math.abs(f.t - h.s) < 0.6))
    .map((h) => ({ t: round(h.s, 2), kind: h.label === "um" ? "um" : h.label === "hmm" || h.label === "hm" ? "hm" : "uh", src: "detector" }));
  return [...fromAsr, ...fromDet].sort((a, b) => a.t - b.t);
}

export type FillerMode = "asr" | "detector" | "acoustic";

function speechMetrics(words: Word[] | null | undefined, durationSec: number, lang: SpeechLang, tl: Timeline,
  fillerMode: FillerMode, fillerHits: FillerHit[] | null): Metrics["speech"] {
  if (!words?.length) return null;
  const items = fillerMode === "acoustic" ? [...mergeFillers(words, null, lang), ...acousticFillers(tl, words)].sort((a, b) => a.t - b.t)
    : mergeFillers(words, fillerMode === "detector" ? fillerHits : null, lang);
  const content = words.filter((w) => !isFilled(w.w, lang));
  const span = Math.max(1, words[words.length - 1].e - words[0].s);
  const minutes = Math.max(durationSec, span) / 60;
  const syl = content.reduce((s, w) => s + syllables(w.w, lang), 0);

  const soft = softList(lang)
    .map((s) => ({ w: s, count: content.filter((w) => norm(w.w) === s).length }))
    .filter((x) => x.count >= 3 && x.count / minutes >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const pauses: Pause[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].s - words[i - 1].e;
    if (gap < 0.6) continue;
    const sentenceEnd = /[.!?:]$/.test(words[i - 1].w.trim());
    pauses.push({ s: round(words[i - 1].e, 2), e: round(words[i].s, 2), dur: round(gap), kind: gap >= 3 ? "hang" : sentenceEnd ? "sentence" : "hesitation" });
  }

  // speaking rate over a sliding 10 s window (articulation incl. pauses inside the window)
  const pace: { t: number; sylPerSec: number }[] = [];
  const end = words[words.length - 1].e;
  for (let t = 0; t + 10 <= Math.max(10, end); t += 2.5) {
    const inWin = content.filter((w) => w.s >= t && w.s < t + 10);
    pace.push({ t: t + 5, sylPerSec: round(inWin.reduce((s, w) => s + syllables(w.w, lang), 0) / 10) });
  }

  return {
    words: content.length,
    wpm: round(content.length / (span / 60), 0),
    sylPerSec: round(syl / span),
    pace,
    fillers: { count: items.length, perMin: round(items.length / minutes), items, estimated: items.some((f) => f.src !== "asr") || fillerMode !== "asr" },
    soft,
    pauses,
    hesitationsPerMin: round(pauses.filter((p) => p.kind !== "sentence").length / minutes),
  };
}

function bodyMetrics(tl: Timeline): Metrics["body"] {
  const idx = tl.face.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const handsOn = idx.filter((i) => tl.hands[i] > 0);
  return {
    handsVisiblePct: round((100 * handsOn.length) / idx.length, 0),
    gestureActivity: round(mean(handsOn.map((i) => tl.motion[i] ?? 0)), 2),
    smilePct: round((100 * idx.filter((i) => tl.smile[i] > 0.5).length) / idx.length, 0),
  };
}

export interface MetricsInput {
  timeline: Timeline;
  durationSec: number;
  targetSec: number;
  lang?: SpeechLang;
  calib?: Calibration | null;
  words?: Word[] | null;
  fillerMode?: FillerMode;
  fillerHits?: FillerHit[] | null;
}

export function computeMetrics({ timeline, durationSec, targetSec, lang = "en", calib = null, words, fillerMode = "asr", fillerHits = null }: MetricsInput): Metrics {
  const gaze = gazeMetrics(timeline, calib);
  const speech = speechMetrics(words, durationSec, lang, timeline, fillerMode, fillerHits);
  return {
    duration: { sec: round(durationSec), target: targetSec, ratio: targetSec ? round(durationSec / targetSec, 2) : null },
    gaze: gaze.out,
    voice: voiceMetrics(timeline),
    speech,
    body: bodyMetrics(timeline),
    look: gaze.look,
  };
}

// ── the one thing to watch next take (tip texts live in i18n under these keys) ──

export type FocusKey = Exclude<FocusId, "auto">;
export interface Focus { key: FocusKey | "vary"; tip: string; value?: number; prev?: number | null }

type Cand = { sev: number; value: number; tip: string };
const FOCI: Record<FocusKey, (m: Metrics) => Cand | null> = {
  fillers: (m) => m.speech && { sev: (m.speech.fillers.perMin - BANDS.fillersPerMin) / 5, value: m.speech.fillers.perMin, tip: "fillers" },
  pace: (m) => m.speech && {
    sev: Math.max(m.speech.sylPerSec - BANDS.sylPerSec[1], BANDS.sylPerSec[0] - m.speech.sylPerSec),
    value: m.speech.sylPerSec, tip: m.speech.sylPerSec > BANDS.sylPerSec[1] ? "paceFast" : "paceSlow",
  },
  gaze: (m) => m.gaze.facePct < 50 ? null : {
    sev: Math.max(m.gaze.downPct - 25, m.gaze.screenPct - 40, 50 - m.gaze.cameraPct) / 20, value: m.gaze.cameraPct,
    tip: m.gaze.screenPct > m.gaze.downPct ? "gazeScreen" : "gazeDown",
  },
  time: (m) => m.duration.ratio == null ? null : {
    sev: (Math.abs(m.duration.ratio - 1) - BANDS.durationTol) / 0.2, value: m.duration.sec,
    tip: m.duration.ratio > 1 ? "timeLong" : "timeShort",
  },
};

export function pickFocus(m: Metrics, prev: Metrics | null, chosen: FocusId | null): Focus {
  const cands = (Object.keys(FOCI) as FocusKey[])
    .map((key) => ({ key, c: FOCI[key](m) }))
    .filter((x): x is { key: FocusKey; c: Cand } => !!x.c && !Number.isNaN(x.c.sev))
    .filter((x) => x.key !== "fillers" || !m.speech?.fillers.estimated || chosen === "fillers"); // never steer on a guess
  let pick = chosen && chosen !== "auto" ? cands.find((x) => x.key === chosen) : undefined;
  if (!pick) pick = cands.filter((x) => x.c.sev > 0).sort((a, b) => b.c.sev - a.c.sev)[0];
  if (!pick) return { key: "vary", tip: "vary" };
  const p = prev ? FOCI[pick.key](prev) : null;
  return { key: pick.key, tip: pick.c.tip, value: pick.c.value, prev: p ? p.value : null };
}

/** Moments worth jumping to in the replay: [key, t]. */
export function keyMoments(m: Metrics): { key: string; t: number }[] {
  const out = [{ key: "start", t: 0 }];
  const g = m.gaze.longestAway;
  if (g && g.dur >= 5) out.push({ key: "away", t: g.s });
  const f = m.speech?.fillers.items ?? [];
  for (let i = 0; i + 2 < f.length; i++) if (f[i + 2].t - f[i].t <= 10) { out.push({ key: "fillerCluster", t: Math.max(0, f[i].t - 2) }); break; }
  const hang = m.speech?.pauses.find((p) => p.kind === "hang");
  if (hang) out.push({ key: "hang", t: Math.max(0, hang.s - 2) });
  if (m.duration.sec > 20) out.push({ key: "end", t: Math.max(0, m.duration.sec - 15) });
  return out.sort((a, b) => a.t - b.t);
}
