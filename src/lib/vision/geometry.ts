// Pure geometry for head-pose-robust gaze: PnP head pose, the "revisiting data normalization" warp (Zhang et al.,
// ETRA 2018) with the ETH-XGaze settings used by ptgaze, and conversions between gaze vectors and angles.
// Camera coordinates: X = image right, Y = image down, Z = forward into the scene (the raw, unmirrored frame).
// Matrices are 3×3 row-major number arrays. Pixel coordinates follow OpenCV/ptgaze: landmark x·width, y·height.
import { CENTER_IDX, FACE_MODEL, FACE_N } from "./face-model";

export type Vec3 = [number, number, number];
export type Mat3 = number[];
export interface Intrinsics { fx: number; fy: number; cx: number; cy: number }
export interface Pose { R: Mat3; t: Vec3 }

export const DEG = 180 / Math.PI;
/** ETH-XGaze normalised camera (ptgaze data/normalized_camera_params/eth-xgaze.yaml + distance 0.6 m). */
export const NORM = { f: 960, size: 224, distance: 0.6 };

/** Unknown intrinsics: focal = image width, principal point = image centre (ptgaze Camera.create_dummy). */
export const dummyIntrinsics = (w: number, h: number): Intrinsics => ({ fx: w, fy: w, cx: Math.floor(w / 2), cy: Math.floor(h / 2) });

export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const kMat = (k: Intrinsics): Mat3 => [k.fx, 0, k.cx, 0, k.fy, k.cy, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export const mulVec = (a: Mat3, v: Vec3): Vec3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];
export const transpose = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) throw new Error("singular matrix");
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
export const unit = (v: Vec3): Vec3 => { const n = norm3(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/** Rotation vector (axis·angle) → matrix (Rodrigues). */
export function rodrigues(r: Vec3): Mat3 {
  const th = norm3(r);
  if (th < 1e-12) return [1, -r[2], r[1], r[2], 1, -r[0], -r[1], r[0], 1];
  const [x, y, z] = [r[0] / th, r[1] / th, r[2] / th], c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/** Rotation from Euler angles (deg) applied as R = Ry(yaw)·Rx(pitch)·Rz(roll); for tests and synthetic faces. */
export function euler(yawDeg: number, pitchDeg: number, rollDeg = 0): Mat3 {
  return mul(rodrigues([0, yawDeg / DEG, 0]), mul(rodrigues([pitchDeg / DEG, 0, 0]), rodrigues([0, 0, rollDeg / DEG])));
}

/** Project model points with pose + intrinsics → Float64Array [u0,v0,u1,v1,…]. */
export function project(pose: Pose, k: Intrinsics, model: Float64Array = FACE_MODEL): Float64Array {
  const n = model.length / 3, out = new Float64Array(n * 2), R = pose.R, t = pose.t;
  for (let i = 0; i < n; i++) {
    const x = model[i * 3], y = model[i * 3 + 1], z = model[i * 3 + 2];
    const X = R[0] * x + R[1] * y + R[2] * z + t[0], Y = R[3] * x + R[4] * y + R[5] * z + t[1], Z = R[6] * x + R[7] * y + R[8] * z + t[2];
    out[i * 2] = (k.fx * X) / Z + k.cx;
    out[i * 2 + 1] = (k.fy * Y) / Z + k.cy;
  }
  return out;
}

/** Initial pose: no rotation, translation from the 2D centroid and spread (scale) of the points. */
function initialPose(model: Float64Array, img: ArrayLike<number>, k: Intrinsics): Pose {
  const n = model.length / 3;
  let mx = 0, my = 0, mz = 0, u0 = 0, v0 = 0;
  for (let i = 0; i < n; i++) { mx += model[i * 3]; my += model[i * 3 + 1]; mz += model[i * 3 + 2]; u0 += img[i * 2]; v0 += img[i * 2 + 1]; }
  mx /= n; my /= n; mz /= n; u0 /= n; v0 /= n;
  let sm = 0, si = 0;
  for (let i = 0; i < n; i++) {
    sm += (model[i * 3] - mx) ** 2 + (model[i * 3 + 1] - my) ** 2;
    si += (img[i * 2] - u0) ** 2 + (img[i * 2 + 1] - v0) ** 2;
  }
  const z = si > 0 ? (k.fx * Math.sqrt(sm)) / Math.sqrt(si) : 1;
  return { R: [...I3], t: [((u0 - k.cx) / k.fx) * z - mx, ((v0 - k.cy) / k.fy) * z - my, z - mz] };
}

/** Solve a 6×6 system A x = b (Gaussian elimination with partial pivoting). */
function solve6(A: Float64Array, b: Float64Array): Float64Array | null {
  const n = 6, M = new Float64Array(A), x = new Float64Array(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-300) return null;
    if (p !== c) {
      for (let j = 0; j < n; j++) { const t = M[c * n + j]; M[c * n + j] = M[p * n + j]; M[p * n + j] = t; }
      const t = x[c]; x[c] = x[p]; x[p] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let j = c; j < n; j++) M[r * n + j] -= f * M[c * n + j];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let j = r + 1; j < n; j++) s -= M[r * n + j] * x[j];
    x[r] = s / M[r * n + r];
  }
  return x;
}

function cost(model: Float64Array, img: ArrayLike<number>, k: Intrinsics, p: Pose): number {
  const n = model.length / 3, R = p.R, t = p.t;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = model[i * 3], y = model[i * 3 + 1], z = model[i * 3 + 2];
    const X = R[0] * x + R[1] * y + R[2] * z + t[0], Y = R[3] * x + R[4] * y + R[5] * z + t[1], Z = R[6] * x + R[7] * y + R[8] * z + t[2];
    if (Z <= 1e-6) return Infinity;
    s += ((k.fx * X) / Z + k.cx - img[i * 2]) ** 2 + ((k.fy * Y) / Z + k.cy - img[i * 2 + 1]) ** 2;
  }
  return s;
}

/** Levenberg–Marquardt PnP (what cv2.solvePnP SOLVEPNP_ITERATIVE does): minimises the reprojection error of the
 *  3D template against 2D landmarks. Rotation is updated multiplicatively, R ← exp([ω]×)·R. */
export function solvePnP(img: ArrayLike<number>, k: Intrinsics, init?: Pose | null, model: Float64Array = FACE_MODEL, maxIter = 40): Pose & { rms: number; iters: number } {
  const n = model.length / 3;
  let pose: Pose = init ? { R: [...init.R], t: [...init.t] as Vec3 } : initialPose(model, img, k);
  let c = cost(model, img, k, pose);
  if (!Number.isFinite(c)) { pose = initialPose(model, img, k); c = cost(model, img, k, pose); }
  let lambda = 1e-3, it = 0;
  const JtJ = new Float64Array(36), Jte = new Float64Array(6), ju = new Float64Array(6), jv = new Float64Array(6);
  for (; it < maxIter; it++) {
    JtJ.fill(0); Jte.fill(0);
    const R = pose.R, t = pose.t;
    for (let i = 0; i < n; i++) {
      const x = model[i * 3], y = model[i * 3 + 1], z = model[i * 3 + 2];
      const Qx = R[0] * x + R[1] * y + R[2] * z, Qy = R[3] * x + R[4] * y + R[5] * z, Qz = R[6] * x + R[7] * y + R[8] * z;
      const X = Qx + t[0], Y = Qy + t[1], Z = Qz + t[2], iz = 1 / Z;
      const eu = k.fx * X * iz + k.cx - img[i * 2], ev = k.fy * Y * iz + k.cy - img[i * 2 + 1];
      // d(u,v)/dP; d/dω = Q × a, d/dt = a
      const a0 = k.fx * iz, a2 = -k.fx * X * iz * iz, b1 = k.fy * iz, b2 = -k.fy * Y * iz * iz;
      ju[0] = Qy * a2; ju[1] = Qz * a0 - Qx * a2; ju[2] = -Qy * a0; ju[3] = a0; ju[4] = 0; ju[5] = a2;
      jv[0] = Qy * b2 - Qz * b1; jv[1] = -Qx * b2; jv[2] = Qx * b1; jv[3] = 0; jv[4] = b1; jv[5] = b2;
      for (let r = 0; r < 6; r++) {
        Jte[r] += ju[r] * eu + jv[r] * ev;
        for (let q = r; q < 6; q++) JtJ[r * 6 + q] += ju[r] * ju[q] + jv[r] * jv[q];
      }
    }
    for (let r = 0; r < 6; r++) for (let q = 0; q < r; q++) JtJ[r * 6 + q] = JtJ[q * 6 + r];
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const A = new Float64Array(JtJ);
      for (let r = 0; r < 6; r++) A[r * 6 + r] *= 1 + lambda;
      const d = solve6(A, Jte.map((v) => -v));
      if (!d) break;
      const next: Pose = { R: mul(rodrigues([d[0], d[1], d[2]]), pose.R), t: [pose.t[0] + d[3], pose.t[1] + d[4], pose.t[2] + d[5]] };
      const nc = cost(model, img, k, next);
      if (nc < c) {
        const rel = (c - nc) / Math.max(c, 1e-12);
        pose = next; c = nc; lambda = Math.max(lambda / 10, 1e-9); improved = true;
        const step = Math.hypot(d[0], d[1], d[2], d[3], d[4], d[5]);
        if (rel < 1e-10 || step < 1e-10) return { ...pose, rms: Math.sqrt(c / n), iters: it + 1 };
      } else lambda *= 10;
    }
    if (!improved) break;
  }
  return { ...pose, rms: Math.sqrt(c / n), iters: it };
}

/** Face centre in camera coordinates (ETH-XGaze: eye corners + nose points of the posed template). */
export function faceCenter(pose: Pose, model: Float64Array = FACE_MODEL): Vec3 {
  const { R, t } = pose, c: Vec3 = [0, 0, 0];
  for (const i of CENTER_IDX) {
    const p = mulVec(R, [model[i * 3], model[i * 3 + 1], model[i * 3 + 2]]);
    c[0] += p[0] + t[0]; c[1] += p[1] + t[1]; c[2] += p[2] + t[2];
  }
  return [c[0] / CENTER_IDX.length, c[1] / CENTER_IDX.length, c[2] / CENTER_IDX.length];
}

/** Normalising rotation (rows x, y, z): z points from the camera to the face centre, x follows the head's x axis. */
export function normalizingRotation(center: Vec3, R: Mat3): Mat3 {
  const z = unit(center), hx: Vec3 = [R[0], R[3], R[6]];
  const y = unit(cross(z, hx)), x = unit(cross(y, z));
  return [...x, ...y, ...z];
}

/** Image warp W = Kn·S·Rn·K⁻¹ (source pixel → normalised pixel), as ptgaze HeadPoseNormalizer. */
export function warpMatrix(k: Intrinsics, Rn: Mat3, distance: number): Mat3 {
  const Kn: Mat3 = [NORM.f, 0, NORM.size / 2, 0, NORM.f, NORM.size / 2, 0, 0, 1];
  const S: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, NORM.distance / distance];
  return mul(Kn, mul(S, mul(Rn, inv3(kMat(k)))));
}

/** Apply a homography to a 2D point. */
export function applyH(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** ptgaze gaze_angles_to_vector: (pitch, yaw) rad → unit vector (towards the target). */
export const anglesToVector = (pitch: number, yaw: number): Vec3 => [-Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
/** ptgaze gaze_vector_to_angles. */
export const vectorToAngles = (v: Vec3): { pitch: number; yaw: number } => ({ pitch: Math.asin(Math.max(-1, Math.min(1, -v[1]))), yaw: Math.atan2(-v[0], -v[2]) });
/** Normalised-camera vector → camera vector (ptgaze denormalize_gaze_vector: v @ Rn = Rnᵀ·v). */
export const denormalize = (v: Vec3, Rn: Mat3): Vec3 => mulVec(transpose(Rn), v);

/** Frame whose -Z axis points from the face centre straight at the camera, X kept as close to image right as possible
 *  (so head roll does not rotate the horizontal/vertical split). */
export function towardsCamera(center: Vec3): Mat3 {
  const z = unit(center), y = unit(cross(z, [1, 0, 0])), x = unit(cross(y, z));
  return [...x, ...y, ...z];
}

/** A direction (camera coordinates) as angles from the face→camera line, degrees: h > 0 = towards image right,
 *  v > 0 = downwards. A ray from the face centre into the lens is (0, 0). */
export function cameraAngles(dir: Vec3, center: Vec3): { h: number; v: number } {
  const d = unit(mulVec(towardsCamera(center), dir));
  return { h: Math.atan2(d[0], -d[2]) * DEG, v: Math.asin(Math.max(-1, Math.min(1, d[1]))) * DEG };
}

/** Head yaw/pitch (deg) of the face's forward axis (template -Z) relative to the line to the camera:
 *  yaw > 0 = face turned towards image right, pitch > 0 = face tilted down. */
export function headAngles(R: Mat3, center: Vec3): { yaw: number; pitch: number } {
  const a = cameraAngles([-R[2], -R[5], -R[8]], center);
  return { yaw: a.h, pitch: a.v };
}

/** Normalised-camera network output (pitch, yaw rad) → gaze angles relative to the camera (deg). */
export function gazeFromModel(pitch: number, yaw: number, Rn: Mat3, center: Vec3): { h: number; v: number } {
  return cameraAngles(denormalize(anglesToVector(pitch, yaw), Rn), center);
}

/** Everything the gaze model needs for one face: pose → centre → Rn → W (and its inverse). */
export function normalization(pose: Pose, k: Intrinsics) {
  const center = faceCenter(pose);
  const Rn = normalizingRotation(center, pose.R);
  const W = warpMatrix(k, Rn, norm3(center));
  return { center, Rn, W, Winv: inv3(W) };
}

/** Source rectangle (integer pixels, clamped to the frame) that the 224² patch samples from, plus the scale at which
 *  to copy it (longest side ≤ maxSide) and the matrix mapping patch pixels → copied-bitmap pixels. */
export function patchSource(Winv: Mat3, frameW: number, frameH: number, maxSide = 320) {
  const s = NORM.size - 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, 0], [0, s / 2], [s, s / 2], [s / 2, s]]) {
    const [x, y] = applyH(Winv, u, v);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const x = Math.max(0, Math.floor(x0) - 2), y = Math.max(0, Math.floor(y0) - 2);
  const w = Math.min(frameW, Math.ceil(x1) + 3) - x, h = Math.min(frameH, Math.ceil(y1) + 3) - y;
  if (!(w > 1 && h > 1)) return null;
  const sc = Math.min(1, maxSide / Math.max(w, h));
  const bw = Math.max(1, Math.round(w * sc)), bh = Math.max(1, Math.round(h * sc));
  const sx = bw / w, sy = bh / h;
  // bitmap index = (frame index - origin + 0.5)·scale - 0.5 (pixel-centre aligned resampling)
  const B: Mat3 = [sx, 0, (0.5 - x) * sx - 0.5, 0, sy, (0.5 - y) * sy - 0.5, 0, 0, 1];
  return { x, y, w, h, bw, bh, M: mul(B, Winv) };
}

export { FACE_N };
