// Live vision: MediaPipe FaceLandmarker (landmarks, blink, smile) + head pose by PnP + ETH-XGaze gaze model in a
// worker + GestureRecognizer for gesture control. All angles in degrees, camera frame (raw image, NOT mirrored):
// h / dH > 0 = speaker looks to image right, v / dV > 0 = looks down. "Into the lens" ≈ (0, 0) even before calibration.
// Booth distance: the face is small, so MediaPipe gets a square crop around the last face at native resolution and the
// gaze model samples its 224² patch straight from the full-resolution frame.
// Frozen camera: Safari stopped updating the hidden camera <video> (every gaze sample identical, 21.10.). A tiny
// signature of each face crop catches that; the loop restarts the video and reports "no face" meanwhile, never a stale
// "into the lens".
import { FaceLandmarker, FilesetResolver, GestureRecognizer, type FaceLandmarkerResult, type GestureRecognizerResult } from "@mediapipe/tasks-vision";
import { createStore, type Store } from "../store";
import type { Calibration } from "../types";
import { Ema, GestureHold, LookTracker, OneEuro, type HV } from "./filters";
import { dummyIntrinsics, faceCenter, gazeFromModel, headAngles, normalization, patchSource, solvePnP, type Intrinsics, type Mat3, type Pose, type Vec3 } from "./geometry";
import type { GazeIn, GazeOut } from "./gaze-worker";
import { activeVision } from "./registry";

export type GestureName = "Open_Palm" | "Thumb_Up" | "Thumb_Down" | "Victory" | "Pointing_Up" | "ILoveYou" | "Closed_Fist";
export type LiveLook = "camera" | "screen" | "down" | "away" | "none";
/** full: face 30 fps + gaze model (calibration, recording); low: face ~5 fps, no gaze (setup, replay); off: nothing. */
export type VisionMode = "full" | "low" | "off";
export interface VisionState {
  ready: boolean; error: string | null;
  face: boolean;
  box: { x: number; y: number; w: number; h: number } | null; // normalised 0..1 in the (unmirrored) video frame
  facePx: number;              // face width in source pixels
  yaw: number; pitch: number;  // head pose deg
  gaze: { h: number; v: number } | null;   // raw gaze deg (camera frame), null = blink/invalid/no face
  rel: { dH: number; dV: number } | null;  // relative to calibration (or raw if uncalibrated)
  look: LiveLook;              // smoothed live class (uses calibration if present)
  hands: number; motion: number; smile: number; blink: boolean;
  /** The camera image stopped changing (browser power saving); vision reports no face until it moves again. */
  frozen: boolean;
  gesture: { name: GestureName; progress: number } | null;
  perf: { faceFps: number; gazeHz: number; gazeMs: number; backend: string };
}
export interface GazeSample { h: number; v: number; yaw: number; pitch: number }
export interface VisionSample {
  face: number; dH: number | null; dV: number | null; hands: number; motion: number; smile: number;
  box: number[] | null;
}
export interface Vision {
  state: Store<VisionState>;
  setOptions(o: Partial<{ gestures: boolean; gaze: boolean; mode: VisionMode }>): void;
  onGesture(fn: (name: GestureName) => void): () => void;
  /** Raw gaze samples (~10 Hz) for `ms`, with head pose: calibration dots and the eye-contact check. */
  collect(ms: number): Promise<GazeSample[]>;
  setCalibration(c: Calibration | null): void;
  calibration(): Calibration | null;
  resetCalibration(): void;
  /** Current values for the 10 Hz take timeline. */
  sample(): VisionSample;
  dispose(): void;
}
// VisionDebug (the ?debug=1 overlay) lives in ./VisionDebug.tsx and is imported lazily by the UI.

const GESTURES = new Set<string>(["Open_Palm", "Thumb_Up", "Thumb_Down", "Victory", "Pointing_Up", "ILoveYou", "Closed_Fist"]);
const FACE_IN = 384;        // MediaPipe face crop canvas (px)
const BODY_IN = 448;        // gesture crop canvas (px)
const FACE_EVERY_MS = 30;   // cap face landmarks at ~30 fps
const GAZE_EVERY_MS = 100;  // gaze model ~10 Hz
const GAZE_STALE_MS = 600;  // older gaze results are not shown
const BLINK = 0.5;
const FROZEN_MS = 700;      // identical face crops this long = the browser stopped updating the camera video
const LOW_FACE_MS = 200;    // "low" mode: face ~5 fps (presence, booth idle), no gaze model
const LONG_BLINK_MS = 600;  // eyes "closed" longer than this (or lids down while reading) counts as looking down
const asset = (p: string) => new URL(p, document.baseURI).href;
const r1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** WebGL that runs on the CPU (SwiftShader, llvmpipe: VMs, blocklisted GPUs): MediaPipe's CPU delegate is faster there. */
function softwareGL(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(r);
  } catch { return false; }
}

type Task<T> = { task: T; delegate: "GPU" | "CPU" };
async function createTask<T>(make: (delegate: "GPU" | "CPU") => Promise<T>, order: readonly ("GPU" | "CPU")[]): Promise<Task<T>> {
  let last: unknown;
  for (const delegate of order) {
    try { return { task: await make(delegate), delegate }; } catch (e) { last = e; console.warn(`[vision] ${delegate} delegate failed`, e); }
  }
  throw last;
}

interface Roi { x: number; y: number; s: number }
type Canvas2D = { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };
function canvas2d(w: number, h: number, readBack = false): Canvas2D {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", readBack ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2d canvas unavailable");
  return { canvas, ctx };
}

function initialState(): VisionState {
  return {
    ready: false, error: null, face: false, box: null, facePx: 0, yaw: 0, pitch: 0, gaze: null, rel: null, look: "none",
    hands: 0, motion: 0, smile: 0, blink: false, frozen: false, gesture: null, perf: { faceFps: 0, gazeHz: 0, gazeMs: 0, backend: "loading" },
  };
}

export async function createVision(video: HTMLVideoElement): Promise<Vision> {
  const state = createStore<VisionState>(initialState());
  const opts: { gestures: boolean; gaze: boolean; mode: VisionMode } = { gestures: true, gaze: true, mode: "full" };
  const listeners = new Set<(n: GestureName) => void>();

  // ---- load MediaPipe + gaze worker in parallel ----
  const worker = new Worker(new URL("./gaze-worker.ts", import.meta.url), { type: "module" });
  let gazeBackend = "loading";
  let gazeError: string | null = null;
  const gazeReady = new Promise<boolean>((resolve) => {
    const onInit = (ev: MessageEvent<GazeOut>) => {
      const m = ev.data;
      if (m.type === "ready") { gazeBackend = m.backend; resolve(true); worker.removeEventListener("message", onInit); }
      else if (m.type === "error" && m.id == null) { gazeBackend = "none"; console.warn("[vision] gaze model:", m.message); gazeError = m.message; resolve(false); worker.removeEventListener("message", onInit); }
    };
    worker.addEventListener("message", onInit);
    worker.onerror = (e) => { gazeBackend = "none"; gazeError = e.message || "worker failed"; resolve(false); };
  });
  worker.postMessage({ type: "init", model: asset("models/eth-xgaze-r18.onnx") } satisfies GazeIn);

  let face: Task<FaceLandmarker> | null = null;
  let gest: Task<GestureRecognizer> | null = null;
  try {
    const fileset = await FilesetResolver.forVisionTasks(asset("vendor/mediapipe"));
    const order = softwareGL() ? (["CPU", "GPU"] as const) : (["GPU", "CPU"] as const);
    const [f, g] = await Promise.allSettled([
      createTask((delegate) => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: asset("vendor/models/face_landmarker.task"), delegate },
        runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
      }), order),
      createTask((delegate) => GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: asset("vendor/models/gesture_recognizer.task"), delegate },
        runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
      }), order),
    ]);
    if (f.status === "rejected") throw f.reason;
    face = f.value;
    if (g.status === "fulfilled") gest = g.value;
    else console.warn("[vision] gestures unavailable", g.reason);
  } catch (e) {
    worker.terminate();
    state.patch({ error: `face tracking unavailable: ${(e as Error)?.message ?? e}`, perf: { ...state.get().perf, backend: "none" } });
    return inert(state);
  }
  const gazeOk = await gazeReady;
  const backendLabel = () => `mediapipe ${face?.delegate ?? "-"} · gaze ${gazeOk ? gazeBackend : "off"}`;
  state.patch({ ready: true, error: gazeOk ? null : `gaze model unavailable: ${gazeError ?? "unknown"}`, perf: { ...state.get().perf, backend: backendLabel() } });

  // ---- per-frame state ----
  const faceC = canvas2d(FACE_IN, FACE_IN);
  const bodyC = canvas2d(BODY_IN, BODY_IN);
  let patchC = canvas2d(64, 64);
  const px = new Float64Array(468 * 2);
  // frozen-frame watch: 16×16 signature of the face crop
  const sigC = canvas2d(16, 16, true);
  let sigLast = -1, sigSince = 0, frozen = false, kicks = 0, lastFace = 0, lastSig = 0;
  let roi: Roi | null = null;
  let scan = 0, lost = 99, frameNo = 0, lastStep = 0, frameW = 0, frameH = 0;
  let pose: Pose | null = null, center: Vec3 | null = null;
  let faceBox: { x: number; y: number; w: number; h: number } | null = null;
  let blinkSince: number | null = null;
  const tsLast = { face: 0, gest: 0 };
  const ts = (k: "face" | "gest") => (tsLast[k] = Math.max(Math.round(performance.now()), tsLast[k] + 1));

  // gaze
  let inflight: { id: number; Rn: Mat3; center: Vec3; t: number } | null = null;
  let nextId = 1, lastSend = 0;
  let gazeRaw: (HV & { t: number }) | null = null;
  let gazeSmooth: HV | null = null;
  const fH = new OneEuro(), fV = new OneEuro();
  const gazeMsEma = new Ema(1000);
  let collector: GazeSample[] | null = null;

  // calibration (built by the studio's calibration screen from collect())
  let calib: Calibration | null = null;
  const look = new LookTracker();

  // hands
  const hold = new GestureHold<GestureName>(600, 0.6);
  const motionEma = new Ema(300), smileEma = new Ema(200);
  const prevWrist = new Map<string, { x: number; y: number; t: number }>();
  let hands = 0;

  // perf counters
  const count = { face: 0, gaze: 0 };
  let errors = 0;
  const perfTimer = setInterval(() => {
    state.patch({ perf: { faceFps: count.face, gazeHz: count.gaze, gazeMs: Math.round(gazeMsEma.value), backend: backendLabel() } });
    count.face = 0; count.gaze = 0;
  }, 1000);

  worker.addEventListener("message", (ev: MessageEvent<GazeOut>) => {
    const m = ev.data;
    if (m.type === "error" && m.id != null) { if (inflight?.id === m.id) inflight = null; if (errors++ < 5) console.warn("[vision] gaze", m.message); return; }
    if (m.type !== "gaze") return;
    const req = inflight;
    if (!req || req.id !== m.id) return;
    inflight = null;
    const g = gazeFromModel(m.pitch, m.yaw, req.Rn, req.center);
    if (!Number.isFinite(g.h) || !Number.isFinite(g.v)) return;
    gazeRaw = { ...g, t: req.t };
    gazeSmooth = { h: fH.filter(g.h, req.t), v: fV.filter(g.v, req.t) };
    if (collector) {
      const head = pose && center ? headAngles(pose.R, center) : { yaw: 0, pitch: 0 };
      collector.push({ h: g.h, v: g.v, yaw: r1(head.yaw), pitch: r1(head.pitch) });
    }
    gazeMsEma.update(m.ms, performance.now());
    count.gaze++;
  });

  function faceRoi(W: number, H: number): Roi {
    const side = Math.min(W, H);
    if (faceBox && lost < 10) {
      const b = faceBox, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const want = clamp(Math.max(b.w, b.h) * 2.4, 160, side);
      // sticky: keep the crop while the face stays near its centre and the size fits, so MediaPipe tracking stays stable
      if (roi && Math.abs(cx - (roi.x + roi.s / 2)) < 0.12 * roi.s && Math.abs(cy - (roi.y + roi.s / 2)) < 0.12 * roi.s && want / roi.s > 0.8 && want / roi.s < 1.25) return roi;
      const s = Math.round(want);
      return (roi = { x: Math.round(clamp(cx - s / 2, 0, W - s)), y: Math.round(clamp(cy - s / 2, 0, H - s)), s });
    }
    // lost: cycle full height, upper centre, then three smaller upper tiles (far faces at the booth)
    roi = null;
    const k = scan++ % 5;
    if (k === 0) return { x: Math.round((W - side) / 2), y: Math.round((H - side) / 2), s: side };
    if (k === 1) { const s = Math.round(side * 0.6); return { x: Math.round((W - s) / 2), y: Math.round(H * 0.05), s }; }
    const s = Math.round(side * 0.4), cols = [0.2, 0.5, 0.8][k - 2];
    return { x: Math.round(clamp(W * cols - s / 2, 0, W - s)), y: Math.round(H * 0.12), s };
  }

  function bodyRoi(W: number, H: number): Roi {
    const side = Math.min(W, H);
    if (!faceBox || lost > 10) return { x: Math.round((W - side) / 2), y: Math.round((H - side) / 2), s: side };
    const b = faceBox, s = Math.round(clamp(b.w * 6, 320, side));
    return { x: Math.round(clamp(b.x + b.w / 2 - s / 2, 0, W - s)), y: Math.round(clamp(b.y + b.h / 2 - s * 0.3, 0, H - s)), s };
  }

  function onFace(res: FaceLandmarkerResult, r: Roi, K: Intrinsics, now: number) {
    const lm = res.faceLandmarks?.[0];
    if (!lm || lm.length < 468) {
      if (++lost > 5) { faceBox = null; pose = null; center = null; blinkSince = null; }
      if (lost > 15) { fH.reset(); fV.reset(); gazeSmooth = null; }
      return;
    }
    lost = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 468; i++) {
      const x = r.x + lm[i].x * r.s, y = r.y + lm[i].y * r.s;
      px[i * 2] = x; px[i * 2 + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    faceBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const fit = solvePnP(px, K, pose);
    pose = fit.rms < 0.1 * faceBox.w ? fit : solvePnP(px, K, null);
    center = faceCenter(pose);
    const bs: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[0]?.categories ?? []) bs[c.categoryName] = c.score;
    const blink = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2 > BLINK;
    blinkSince = blink ? (blinkSince ?? now) : null;
    smileEma.update(((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2, now);
  }

  function sendGaze(K: Intrinsics, now: number) {
    if (!pose || !center || inflight || now - lastSend < GAZE_EVERY_MS) return;
    const n = normalization(pose, K);
    const src = patchSource(n.Winv, frameW, frameH);
    if (!src) return;
    if (patchC.canvas.width !== src.bw || patchC.canvas.height !== src.bh) {
      patchC = canvas2d(src.bw, src.bh);
      patchC.ctx.imageSmoothingQuality = "medium";
    }
    patchC.ctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, src.bw, src.bh);
    const id = nextId++;
    inflight = { id, Rn: n.Rn, center: n.center, t: now };
    lastSend = now;
    const post = (bitmap: ImageBitmap) => worker.postMessage({ type: "frame", id, bitmap, M: src.M } satisfies GazeIn, [bitmap]);
    if ("transferToImageBitmap" in patchC.canvas) post(patchC.canvas.transferToImageBitmap());
    else createImageBitmap(patchC.canvas).then(post, () => { if (inflight?.id === id) inflight = null; });
  }

  function onHands(res: GestureRecognizerResult, r: Roi, now: number) {
    const lms = res.landmarks ?? [];
    hands = lms.length;
    const fw = faceBox?.w ?? r.s / 6;
    let speed = 0;
    const seen = new Set<string>();
    lms.forEach((hand, i) => {
      const label = res.handedness?.[i]?.[0]?.categoryName ?? String(i);
      const w = { x: r.x + hand[0].x * r.s, y: r.y + hand[0].y * r.s, t: now };
      const p = prevWrist.get(label);
      if (p && now > p.t && now - p.t < 400) speed = Math.max(speed, Math.hypot(w.x - p.x, w.y - p.y) / fw / ((now - p.t) / 1000));
      prevWrist.set(label, w);
      seen.add(label);
    });
    for (const k of [...prevWrist.keys()]) if (!seen.has(k)) prevWrist.delete(k);
    motionEma.update(Math.min(speed, 50), now);

    let best: { name: GestureName; score: number } | null = null;
    for (const g of res.gestures ?? []) {
      const c = g[0];
      if (c && GESTURES.has(c.categoryName) && (!best || c.score > best.score)) best = { name: c.categoryName as GestureName, score: c.score };
    }
    if (!opts.gestures) return;
    const h = hold.update(best, now);
    if (h.fire) for (const fn of listeners) { try { fn(h.fire); } catch (e) { console.error(e); } }
    gestureState = h.state;
  }
  let gestureState: { name: GestureName; progress: number } | null = null;

  function step() {
    const now = performance.now();
    if (opts.mode === "off" || now - lastStep < FACE_EVERY_MS || video.readyState < 2 || !video.videoWidth) return;
    lastStep = now;
    frameNo++;
    const W = video.videoWidth, H = video.videoHeight;
    if (W !== frameW || H !== frameH) { frameW = W; frameH = H; roi = null; pose = null; faceBox = null; lost = 99; }
    const full = opts.mode === "full";

    if (full || now - lastFace >= LOW_FACE_MS) {
      lastFace = now;
      const K = dummyIntrinsics(W, H);
      const fr = faceRoi(W, H);
      faceC.ctx.drawImage(video, fr.x, fr.y, fr.s, fr.s, 0, 0, FACE_IN, FACE_IN);
      if (now - lastSig >= 250) { lastSig = now; watchFrozen(now); } // a GPU read-back: 4×/s is plenty
      if (frozen) { lost = 99; faceBox = null; pose = null; center = null; publish(now, false, W, H); return; }
      onFace(face!.task.detectForVideo(faceC.canvas as HTMLCanvasElement, ts("face")), fr, K, now);
      count.face++;
      const hasFace = lost === 0 && !!faceBox;
      const blink = blinkSince != null;
      if (full && opts.gaze && gazeOk && hasFace && !blink) sendGaze(K, now);
      publish(now, blink, W, H);
    }
    // hands in their own task, so face + hands never add up to one long main-thread task (~10 ms each on M-series).
    // Gesture control: every 2nd frame (~15 Hz) while a hand is up, else every 3rd. Without gestures only while
    // recording (hand motion for the take).
    if (gest && (opts.gestures || full) && frameNo % (opts.gestures && hands > 0 ? 2 : 3) === 0) setTimeout(handStep, 0);
  }

  /** A live camera never delivers two identical crops (sensor noise). If it does for FROZEN_MS, restart the video. */
  function watchFrozen(now: number) {
    sigC.ctx.drawImage(faceC.canvas as CanvasImageSource, 0, 0, 16, 16);
    const d = sigC.ctx.getImageData(0, 0, 16, 16).data;
    let sig = 0;
    for (let i = 0; i < d.length; i += 4) sig = (sig * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) | 0;
    if (sig !== sigLast) {
      sigLast = sig; sigSince = now;
      if (frozen) { frozen = false; kicks = 0; console.info("[vision] camera image moving again"); }
      return;
    }
    if (now - sigSince < FROZEN_MS) return;
    if (!frozen) { frozen = true; console.warn("[vision] camera image frozen, restarting the video"); }
    if (now - sigSince > FROZEN_MS * (kicks + 1)) {
      kicks++;
      if (kicks % 3 === 0 && video.srcObject) { const so = video.srcObject; video.srcObject = null; video.srcObject = so; } // re-attach
      video.pause(); void video.play().catch(() => {});
    }
  }

  function handStep() {
    if (disposed || !gest || video.readyState < 2 || !video.videoWidth) return;
    try {
      const now = performance.now(), W = video.videoWidth, H = video.videoHeight;
      const br = bodyRoi(W, H);
      bodyC.ctx.drawImage(video, br.x, br.y, br.s, br.s, 0, 0, BODY_IN, BODY_IN);
      onHands(gest.task.recognizeForVideo(bodyC.canvas as HTMLCanvasElement, ts("gest")), br, now);
      state.patch({ hands, motion: r1(motionEma.value), gesture: opts.gestures ? gestureState : null });
    } catch (e) { if (errors++ < 5) console.error("[vision] hands", e); }
  }

  function relOf(g: HV | null): VisionState["rel"] {
    if (!g) return null;
    const c = calib?.cam ?? { h: 0, v: 0 };
    return { dH: g.h - c.h, dV: g.v - c.v };
  }

  function publish(now: number, blink: boolean, W: number, H: number) {
    const fresh = opts.gaze && gazeRaw && now - gazeRaw.t < GAZE_STALE_MS ? gazeSmooth : null;
    const showFace = lost <= 5 && !!faceBox;
    const gaze = showFace && !blink && fresh ? { h: r1(fresh.h), v: r1(fresh.v) } : null;
    const rel = relOf(gaze);
    const head = pose && center ? headAngles(pose.R, center) : { yaw: 0, pitch: 0 };
    const longBlink = blinkSince != null && now - blinkSince > LONG_BLINK_MS;
    // gaze switched off: no live class (head pose alone cannot tell lens from screen)
    const cls = opts.gaze ? look.update({ face: showFace, rel: longBlink ? { dH: 0, dV: 90 } : rel, headYaw: head.yaw, calib }, now) : "none";
    const b = faceBox;
    state.set((s) => ({
      ...s,
      face: showFace,
      frozen,
      box: showFace && b ? { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H } : null,
      facePx: showFace && b ? Math.round(b.w) : 0,
      yaw: r1(head.yaw), pitch: r1(head.pitch),
      gaze, rel: rel && { dH: r1(rel.dH), dV: r1(rel.dV) }, look: cls,
      hands, motion: r1(motionEma.value), smile: Math.round(smileEma.value * 100) / 100, blink: showFace && blink,
      gesture: opts.gestures ? gestureState : null,
    }));
  }

  // ---- loop: requestVideoFrameCallback, with a timer as watchdog (hidden/paused video elements stop rVFC) ----
  let disposed = false;
  const rvfc = "requestVideoFrameCallback" in video;
  const loop = () => {
    if (disposed) return;
    try { step(); } catch (e) { if (errors++ < 5) console.error("[vision] step", e); }
    if (rvfc) video.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  };
  loop();
  const watchdog = setInterval(() => {
    if (!disposed && performance.now() - lastStep > 400) { try { step(); } catch (e) { if (errors++ < 5) console.error("[vision] step", e); } }
  }, 250);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const api: Vision = {
    state,
    setOptions(o) {
      if (o.mode && o.mode !== opts.mode) { sigLast = -1; sigSince = performance.now(); lastFace = 0; }
      Object.assign(opts, o);
      if (o.gaze === false) { inflight = null; gazeRaw = null; gazeSmooth = null; fH.reset(); fV.reset(); }
      if (o.gestures === false) { hold.reset(); gestureState = null; }
    },
    onGesture(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async collect(ms) {
      if (!gazeOk) return [];
      const samples: GazeSample[] = [];
      collector = samples;
      await sleep(ms);
      if (collector === samples) collector = null;
      return samples;
    },
    setCalibration(c) { calib = c; look.reset(); },
    calibration: () => calib,
    resetCalibration() { calib = null; look.reset(); },
    sample() {
      const s = state.get();
      const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
      return {
        face: s.face ? 1 : 0, dH: s.rel?.dH ?? null, dV: s.rel?.dV ?? null, hands: s.hands, motion: s.motion, smile: s.smile,
        box: s.box && [r4(s.box.x), r4(s.box.y), r4(s.box.w), r4(s.box.h)],
      };
    },
    dispose() {
      disposed = true;
      clearInterval(perfTimer); clearInterval(watchdog);
      worker.terminate();
      face?.task.close(); gest?.task.close();
      listeners.clear();
      state.patch({ ready: false });
      if (activeVision.get() === api) activeVision.set(null);
    },
  };
  activeVision.set(api);
  return api;
}

/** A Vision that never sees anything (MediaPipe failed to load); state.error says why. */
function inert(state: Store<VisionState>): Vision {
  return {
    state,
    setOptions() {},
    onGesture: () => () => {},
    collect: async () => [],
    setCalibration() {},
    calibration: () => null,
    resetCalibration() {},
    sample: () => ({ face: 0, dH: null, dV: null, hands: 0, motion: 0, smile: 0, box: null }),
    dispose() {},
  };
}
