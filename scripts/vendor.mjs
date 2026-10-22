// Puts MediaPipe's WASM runtime and the vision models into public/vendor, so the app never loads code
// from a CDN at runtime. Idempotent. MediaPipe stays on 0.10.35: 1.x phones home to odml.pa.googleapis.com.
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
const exists = (p) => stat(p).then(() => true, () => false);

const mpWasm = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  await mkdir(join(out, "mediapipe"), { recursive: true });
  await copyFile(join(mpWasm, f), join(out, "mediapipe", f));
}

const MODELS = "https://storage.googleapis.com/mediapipe-models";
const models = {
  "face_landmarker.task": `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  "gesture_recognizer.task": `${MODELS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
};
await mkdir(join(out, "models"), { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const dest = join(out, "models", name);
  if (await exists(dest)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
  console.log("vendor:", name);
}
// ── ASR ── ONNX Runtime WASM for transformers.js in the ASR worker (CSP allows no CDN scripts): the
// onnxruntime-web build transformers pins (nested under it while the app's own onnxruntime-web differs).
// Versioned folder so Cache Storage never mixes versions. asyncify = WebGPU + WASM; plain = Safari < 26
// without WebGPU (same choice transformers makes).
{
  const { readFile } = await import("node:fs/promises");
  const nested = join(root, "node_modules", "@huggingface", "transformers", "node_modules", "onnxruntime-web");
  const ortPkg = (await exists(nested)) ? nested : join(root, "node_modules", "onnxruntime-web");
  const ortDist = join(ortPkg, "dist");
  const { version } = JSON.parse(await readFile(join(ortPkg, "package.json"), "utf8"));
  const dest = join(out, "ort-asr", version);
  await mkdir(dest, { recursive: true });
  for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
    if (!(await exists(join(dest, f)))) await copyFile(join(ortDist, f), join(dest, f));
  }
}
// ── /ASR ──
console.log("vendor ready");
