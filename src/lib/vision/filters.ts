// Pure temporal logic for the live vision state: smoothing, the hysteresis "look" class, calibration statistics and
// the gesture hold. Angles in degrees (dH > 0 = image right, dV > 0 = down), times in ms.
import { GAZE, LOOK, MAP, classifyMapped, mapGaze, type Look } from "../analysis/metrics";
import type { Calibration, GazeMap } from "../types";

export type LiveLook = "camera" | "screen" | "down" | "away" | "none";
export interface HV { h: number; v: number }

/** One-Euro filter (Casiez et al. 2012). minCutoff 0.8 Hz ≈ τ 200 ms at rest; beta lets saccades through. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 0.8, private beta = 0.01, private dCutoff = 1) {}
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x: number, tMs: number): number {
    if (this.x == null) { this.x = x; this.t = tMs; this.dx = 0; return x; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
  reset() { this.x = null; }
}

/** Exponential moving average with a time constant (frame-rate independent). */
export class Ema {
  value: number;
  private t: number | null = null;
  constructor(private tauMs: number, initial = 0) { this.value = initial; }
  update(x: number, tMs: number): number {
    if (this.t == null) { this.value = x; this.t = tMs; return x; }
    const a = 1 - Math.exp(-Math.max(0, tMs - this.t) / this.tauMs);
    this.t = tMs;
    this.value += a * (x - this.value);
    return this.value;
  }
  reset(x = 0) { this.value = x; this.t = null; }
}

export const LIVE = { marginDeg: 2, dwellMs: 200, awayYawDeg: 40 };

/** Same zones as metrics.classifyLook, with every border shifted by ±margin in favour of the current class. */
export function classifyWithHysteresis(rel: { dH: number; dV: number }, screen: Calibration["screen"], radius: number, current: LiveLook, margin = LIVE.marginDeg): Exclude<LiveLook, "none"> {
  const m = (cls: LiveLook) => (current === cls ? margin : -margin);
  const dc = Math.hypot(rel.dH, rel.dV);
  const ds = screen ? Math.hypot(rel.dH - screen.h, rel.dV - screen.v) : Infinity;
  if (dc <= radius + m("camera") && dc <= ds) return "camera";
  if (ds <= GAZE.screenDeg + m("screen")) return "screen";
  if (rel.dV >= GAZE.downDeg - m("down")) return "down";
  return "away";
}

const LIVE_OF: Record<Look, LiveLook> = { [LOOK.NONE]: "none", [LOOK.CAMERA]: "camera", [LOOK.SCREEN]: "screen", [LOOK.DOWN]: "down", [LOOK.AWAY]: "away" };
const LOOK_OF: Record<LiveLook, Look> = { none: LOOK.NONE, camera: LOOK.CAMERA, screen: LOOK.SCREEN, down: LOOK.DOWN, away: LOOK.AWAY };

/** Live look class: hysteresis on the zone borders plus a minimum dwell before switching. */
export class LookTracker {
  current: LiveLook = "none";
  private pending: LiveLook | null = null;
  private since = 0;
  /** `rel` null with face = gaze unknown (blink / model not ready): keep the current class. */
  update(o: { face: boolean; rel: { dH: number; dV: number } | null; headYaw: number; calib: Calibration | null }, tMs: number): LiveLook {
    let cand: LiveLook;
    const yawLimit = LIVE.awayYawDeg + (this.current === "away" ? -LIVE.marginDeg : LIVE.marginDeg);
    if (!o.face) cand = "none";
    else if (Math.abs(o.headYaw) > yawLimit) cand = "away";
    else if (!o.rel) return this.current;
    else if (o.calib?.map) {
      const m = o.calib.map;
      cand = LIVE_OF[classifyMapped(o.calib.cam.h + o.rel.dH, o.calib.cam.v + o.rel.dV, m, LOOK_OF[this.current], 0.25 * m.r)];
    } else cand = classifyWithHysteresis(o.rel, o.calib?.screen ?? null, o.calib?.radius ?? GAZE.cameraDeg, this.current);
    if (cand === this.current) { this.pending = null; return this.current; }
    if (cand !== this.pending) { this.pending = cand; this.since = tMs; }
    if (tMs - this.since >= LIVE.dwellMs) { this.current = cand; this.pending = null; }
    return this.current;
  }
  reset() { this.current = "none"; this.pending = null; }
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export interface GazeStats { h: number; v: number; sd: number; n: number; samples: HV[] }

/** Mean and 2D SD (RMS distance from the mean) after dropping outliers further than 4× the median distance
 *  (min 3°) from the median, e.g. a glance away during calibration. */
export function gazeStats(samples: HV[]): GazeStats | null {
  if (!samples.length) return null;
  const mh = median(samples.map((s) => s.h)), mv = median(samples.map((s) => s.v));
  const d = samples.map((s) => Math.hypot(s.h - mh, s.v - mv));
  const lim = Math.max(3, 4 * median(d));
  const kept = samples.filter((_, i) => d[i] <= lim);
  const h = mean(kept.map((s) => s.h)), v = mean(kept.map((s) => s.v));
  const sd = Math.sqrt(mean(kept.map((s) => (s.h - h) ** 2 + (s.v - v) ** 2)));
  return { h, v, sd, n: kept.length, samples: kept };
}

/** d′ between two gaze clusters along the line joining their means: |Δμ| / sqrt((σa² + σb²) / 2). */
export function dPrime(a: GazeStats, b: GazeStats, floorDeg = 0.25): number {
  const dh = b.h - a.h, dv = b.v - a.v, dist = Math.hypot(dh, dv);
  if (dist < 1e-9) return 0;
  const ux = dh / dist, uy = dv / dist;
  const sdAlong = (s: GazeStats) => {
    const p = s.samples.map((x) => (x.h - s.h) * ux + (x.v - s.v) * uy);
    return Math.max(floorDeg, Math.sqrt(mean(p.map((q) => q * q))));
  };
  const sa = sdAlong(a), sb = sdAlong(b);
  return dist / Math.sqrt((sa * sa + sb * sb) / 2);
}

export const CALIB = { maxRadiusDeg: 8, minDPrime: 2, maxSpreadDeg: 6 };
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Calibration from the lens sample and an optional screen-centre sample (raw gaze degrees). */
export function buildCalibration(cam: GazeStats, screen: GazeStats | null, at = Date.now()): Calibration {
  const base = { cam: { h: r1(cam.h), v: r1(cam.v) }, spread: r1(cam.sd), at };
  if (!screen) return { ...base, screen: null, radius: CALIB.maxRadiusDeg, separation: null };
  const rel = { h: screen.h - cam.h, v: screen.v - cam.v }, dist = Math.hypot(rel.h, rel.v);
  const sep = dPrime(cam, screen);
  const ok = sep >= CALIB.minDPrime;
  return {
    ...base,
    screen: ok ? { h: r1(rel.h), v: r1(rel.v) } : null,
    radius: r1(ok ? Math.min(CALIB.maxRadiusDeg, dist / 2) : CALIB.maxRadiusDeg),
    separation: r1(sep),
  };
}

/** Least squares x = a0 + a1·h + a2·v (and the same for y) over the dot means, then where the lens sample lands and
 *  how big its zone is. Null when the dots don't describe a screen (too few, collinear, noisy, lens inside the screen):
 *  the caller keeps the degree rule. */
export function fitGazeMap(dots: { h: number; v: number; x: number; y: number }[], lens: GazeStats, vw: number, vh: number): GazeMap | null {
  if (dots.length < 4) return null;
  const solve = (key: "x" | "y") => {
    // normal equations for [1, h, v]
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const d of dots) {
      const r = [1, d.h, d.v];
      for (let i = 0; i < 3; i++) { b[i] += r[i] * d[key]; for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; }
    }
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-9) return null;
    return [0, 1, 2].map((c) => det(A.map((row, i) => row.map((x, j) => (j === c ? b[i] : x)))) / D); // Cramer
  };
  const ax = solve("x"), ay = solve("y");
  if (!ax || !ay) return null;
  const a = [...ax, ...ay] as GazeMap["a"];
  const m0 = { a, lens: { x: 0, y: 0 }, r: 0, vw, vh, rms: 0 };
  const rms = Math.sqrt(mean(dots.map((d) => { const p = mapGaze(m0, d.h, d.v); return (p.x - d.x) ** 2 + (p.y - d.y) ** 2; })));
  const lp = mapGaze(m0, lens.h, lens.v);
  const short = Math.min(vw, vh);
  const toCentre = Math.hypot(lp.x - vw / 2, lp.y - vh / 2);
  const inside = Math.min(lp.x, vw - lp.x, lp.y, vh - lp.y); // > 0 = the lens sample lands inside the viewport
  const gain = Math.sqrt(Math.abs(a[1] * a[5] - a[2] * a[4])); // px per degree
  if (!Number.isFinite(rms) || rms > 0.15 * short || toCentre < 0.25 * short || inside > 0.2 * short || !(gain > 0)) return null;
  const r = Math.min(MAP.maxShare * toCentre, Math.max(MAP.lensShare * toCentre, 2 * lens.sd * gain));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { a: a.map((x) => Math.round(x * 1000) / 1000) as GazeMap["a"], lens: { x: r1(lp.x), y: r1(lp.y) }, r: r1(r), vw, vh, rms: r1(rms) };
}

/** A gesture fires once it has been held `holdMs` with score > minScore; it must be released before it fires again.
 *  Dropouts up to graceMs (missed detections) do not count as a release. */
export class GestureHold<N extends string = string> {
  private name: N | null = null;
  private since = 0;
  private lastSeen = 0;
  private fired = false;
  constructor(public holdMs = 800, public minScore = 0.6, public graceMs = 250) {}
  update(best: { name: N; score: number } | null, tMs: number): { state: { name: N; progress: number } | null; fire: N | null } {
    const seen = best && best.score > this.minScore ? best.name : null;
    if (!seen) {
      if (this.name && tMs - this.lastSeen <= this.graceMs) return { state: { name: this.name, progress: this.progress(this.lastSeen) }, fire: null };
      this.name = null; this.fired = false;
      return { state: null, fire: null };
    }
    if (seen !== this.name) { this.name = seen; this.since = tMs; this.fired = false; }
    this.lastSeen = tMs;
    const progress = this.progress(tMs);
    let fire: N | null = null;
    if (!this.fired && progress >= 1) { this.fired = true; fire = seen; }
    return { state: { name: seen, progress }, fire };
  }
  private progress(t: number) { return Math.min(1, Math.max(0, (t - this.since) / this.holdMs)); }
  reset() { this.name = null; this.fired = false; }
}
