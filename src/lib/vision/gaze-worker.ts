// Gaze model worker: ETH-XGaze ResNet-18 (hysts/ptgaze, MIT; trained on the non-commercial research dataset
// ETH-XGaze, so this prototype stays non-commercial) in onnxruntime-web, WebGPU first, WASM fallback.
// Model file public/models/eth-xgaze-r18.onnx comes from scripts/convert-gaze.py, format "fp16w": fp16 weights that
// ORT casts to fp32 once at load, so it is 22 MB on the wire but computes in fp32 on both execution providers
// (a full-fp16 graph also ran, but needs shader-f16 on WebGPU and drifted 0.1° on WebKit's WebGPU).
// Measured 2026-10-21, M2 Pro under load, model run only: WebGPU 8–13 ms (Chrome 133, WebKit 27.2), WASM 1 thread 93 ms.
// Protocol: init {model} → ready {backend, loadMs} | error; frame {id, bitmap, M} → gaze {id, pitch, yaw, ms, runMs}.
// M maps patch pixels (224²) to bitmap pixels; the bitmap is the source crop the main thread copied from the video.
import * as ort from "onnxruntime-web/webgpu";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { warpToTensor } from "./warp";

export type GazeIn =
  | { type: "init"; model: string; prefer?: "webgpu" | "wasm" }
  | { type: "frame"; id: number; bitmap: ImageBitmap; M: number[]; debug?: boolean };
export type GazeOut =
  | { type: "ready"; backend: string; loadMs: number; selfTest: number[] }
  | { type: "error"; id?: number; message: string }
  | { type: "gaze"; id: number; pitch: number; yaw: number; ms: number; runMs: number; input?: Float32Array };

const SIZE = 224;
// Network output for the synthetic pattern below (PyTorch, fp32 weights; see scripts/convert-gaze.py).
const SELF_TEST = [0.040772, -0.241972];
const post = (m: GazeOut, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

let session: ort.InferenceSession | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
const input = new Float32Array(3 * SIZE * SIZE);

function pattern(): Float32Array {
  const t = new Float32Array(3 * SIZE * SIZE), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const xx = x / SIZE, yy = y / SIZE, i = y * SIZE + x;
    const c = [0.5 + 0.4 * Math.sin(6 * xx), 0.5 + 0.4 * Math.cos(5 * yy), 0.5 + 0.3 * Math.sin(4 * (xx + yy))];
    for (let k = 0; k < 3; k++) t[k * SIZE * SIZE + i] = (c[k] - mean[k]) / std[k];
  }
  return t;
}

async function infer(s: ort.InferenceSession, data: Float32Array): Promise<[number, number]> {
  const out = await s.run({ input: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]) });
  const g = (await out.gaze.getData()) as Float32Array;
  out.gaze.dispose?.();
  return [g[0], g[1]];
}

async function init(model: string, prefer: "webgpu" | "wasm" = "webgpu") {
  const t0 = performance.now();
  ort.env.logLevel = "error";
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.wasm.proxy = false;
  const res = await fetch(model);
  if (!res.ok) throw new Error(`model ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const eps: ("webgpu" | "wasm")[] = prefer === "webgpu" && gpu && (await gpu.requestAdapter().catch(() => null)) ? ["webgpu", "wasm"] : ["wasm"];
  const errors: string[] = [];
  for (const ep of eps) {
    try {
      const s = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
      const test = await infer(s, pattern());
      const err = Math.max(Math.abs(test[0] - SELF_TEST[0]), Math.abs(test[1] - SELF_TEST[1]));
      if (!(err < 0.01)) { errors.push(`${ep}: self-test off by ${err}`); await s.release(); continue; }
      session = s;
      const backend = ep === "wasm" ? `wasm×${ort.env.wasm.numThreads}` : ep;
      post({ type: "ready", backend, loadMs: Math.round(performance.now() - t0), selfTest: test });
      return;
    } catch (e) {
      errors.push(`${ep}: ${(e as Error).message ?? e}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function frame(m: Extract<GazeIn, { type: "frame" }>) {
  const t0 = performance.now();
  const { bitmap } = m;
  try {
    if (!session) throw new Error("not ready");
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!ctx) throw new Error("no 2d context");
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    warpToTensor(img.data, img.width, img.height, m.M, SIZE, input);
    const t1 = performance.now();
    const [pitch, yaw] = await infer(session, input);
    const t2 = performance.now();
    post({ type: "gaze", id: m.id, pitch, yaw, ms: t2 - t0, runMs: t2 - t1, ...(m.debug ? { input: input.slice() } : {}) });
  } catch (e) {
    post({ type: "error", id: m.id, message: (e as Error).message ?? String(e) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (ev: MessageEvent<GazeIn>) => {
  const m = ev.data;
  if (m.type === "init") init(m.model, m.prefer).catch((e) => post({ type: "error", message: (e as Error).message ?? String(e) }));
  else if (m.type === "frame") void frame(m);
};
