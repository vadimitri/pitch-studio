import { describe, expect, it } from "vitest";
import { FACE_MODEL } from "./face-model";
import {
  DEG, NORM, anglesToVector, applyH, cameraAngles, denormalize, dummyIntrinsics, euler, faceCenter, gazeFromModel, headAngles,
  inv3, mul, mulVec, normalization, patchSource, project, rodrigues, solvePnP, transpose, unit, vectorToAngles, type Mat3, type Pose, type Vec3,
} from "./geometry";

const K = dummyIntrinsics(1280, 720);
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const angleBetween = (a: Mat3, b: Mat3) => {
  const R = mul(a, transpose(b));
  return Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2))) * DEG;
};
// deterministic noise
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

describe("matrices", () => {
  it("inverts and composes rotations", () => {
    const R = rodrigues([0.2, -0.4, 0.1]);
    expect(maxDiff(mul(R, inv3(R)), [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeLessThan(1e-12);
    expect(maxDiff(inv3(R), [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]])).toBeLessThan(1e-12);
  });
});

describe("solvePnP", () => {
  it("frontal synthetic landmarks give identity rotation", () => {
    const truth: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0.02, 0.6] };
    const fit = solvePnP(project(truth, K), K);
    expect(angleBetween(fit.R, truth.R)).toBeLessThan(0.01);
    expect(maxDiff(fit.t, truth.t)).toBeLessThan(1e-5);
    expect(fit.rms).toBeLessThan(1e-4);
  });

  it("recovers a turned, off-centre head from noisy landmarks (booth distance)", () => {
    const truth: Pose = { R: euler(25, -12, 6), t: [0.35, -0.15, 2.2] };
    const k4 = dummyIntrinsics(3840, 2160);
    const img = project(truth, k4).map((x) => x + rnd() * 1.5);
    const fit = solvePnP(img, k4);
    expect(angleBetween(fit.R, truth.R)).toBeLessThan(3);
    expect(Math.abs(fit.t[2] - truth.t[2]) / truth.t[2]).toBeLessThan(0.05);
  });

  it("warm start converges in few iterations", () => {
    const a: Pose = { R: euler(10, 5), t: [0.05, 0, 0.7] }, b: Pose = { R: euler(12, 4), t: [0.055, 0, 0.7] };
    const fitA = solvePnP(project(a, K), K);
    const fitB = solvePnP(project(b, K), K, fitA);
    expect(fitB.iters).toBeLessThan(10);
    expect(angleBetween(fitB.R, b.R)).toBeLessThan(0.05);
  });
});

describe("normalisation", () => {
  it("frontal face at the image centre warps to an upright, centred patch", () => {
    const pose: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0.6] };
    pose.t = [-faceCenter({ R: pose.R, t: [0, 0, 0] })[0], -faceCenter({ R: pose.R, t: [0, 0, 0] })[1], 0.6];
    const n = normalization(pose, K);
    expect(angleBetween(n.Rn, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeLessThan(0.01);
    const p = project(pose, K);
    // face centre → patch centre
    const c = n.center, cu = (K.fx * c[0]) / c[2] + K.cx, cv = (K.fy * c[1]) / c[2] + K.cy;
    const [u, v] = applyH(n.W, cu, cv);
    expect(Math.abs(u - NORM.size / 2)).toBeLessThan(1e-6);
    expect(Math.abs(v - NORM.size / 2)).toBeLessThan(1e-6);
    // eye corners level and 89 mm apart → 960·0.089/0.6 ≈ 142 px in the patch (a little less: they sit ~1.5 cm
    // behind the face centre, and the warp only rescales distance at the centre)
    const [ru, rv] = applyH(n.W, p[33 * 2], p[33 * 2 + 1]);
    const [lu, lv] = applyH(n.W, p[263 * 2], p[263 * 2 + 1]);
    expect(Math.abs(rv - lv)).toBeLessThan(1e-6);
    expect(ru).toBeLessThan(lu); // landmark 33 (subject's right eye) stays on image left: no mirroring
    expect(Math.abs((lu - ru) / ((960 * 0.0889) / 0.6) - 1)).toBeLessThan(0.03);
  });

  it("a rolled head is de-rolled in the patch", () => {
    const pose: Pose = { R: euler(0, 0, 20), t: [0.1, 0.05, 0.8] };
    const n = normalization(pose, K), p = project(pose, K);
    const [, rv] = applyH(n.W, p[33 * 2], p[33 * 2 + 1]);
    const [, lv] = applyH(n.W, p[263 * 2], p[263 * 2 + 1]);
    expect(Math.abs(rv - lv)).toBeLessThan(0.5);
  });

  it("patch scale does not depend on distance", () => {
    const eyeDist = (z: number) => {
      const pose: Pose = { R: euler(0, 0), t: [0, 0, z] };
      const n = normalization(pose, K), p = project(pose, K);
      return applyH(n.W, p[263 * 2], p[263 * 2 + 1])[0] - applyH(n.W, p[33 * 2], p[33 * 2 + 1])[0];
    };
    expect(Math.abs(eyeDist(0.5) / eyeDist(2.0) - 1)).toBeLessThan(0.02); // only residual perspective
  });

  it("patchSource maps the patch into the copied crop", () => {
    const pose: Pose = { R: euler(5, 3), t: [0.02, 0.01, 0.6] };
    const n = normalization(pose, K);
    const src = patchSource(n.Winv, 1280, 720, 320)!;
    expect(Math.max(src.bw, src.bh)).toBeLessThanOrEqual(320);
    // patch centre in frame px → in crop px via the crop's own scale
    const [fx, fy] = applyH(n.Winv, 112, 112);
    const [bx, by] = applyH(src.M, 112, 112);
    expect(Math.abs(bx - ((fx - src.x + 0.5) * (src.bw / src.w) - 0.5))).toBeLessThan(1e-6);
    expect(Math.abs(by - ((fy - src.y + 0.5) * (src.bh / src.h) - 0.5))).toBeLessThan(1e-6);
  });
});

describe("gaze angles", () => {
  it("ptgaze angle ↔ vector conventions round-trip", () => {
    const v = anglesToVector(0.1, -0.3), a = vectorToAngles(v);
    expect(Math.abs(a.pitch - 0.1)).toBeLessThan(1e-12);
    expect(Math.abs(a.yaw + 0.3)).toBeLessThan(1e-12);
  });

  it("a gaze ray pointing at the camera is (0, 0), wherever the face is", () => {
    for (const [pose, k] of [
      [{ R: euler(0, 0), t: [0, 0, 0.6] }, K],
      [{ R: euler(30, -10, 8), t: [0.4, -0.2, 1.8] }, dummyIntrinsics(1920, 1080)],
    ] as [Pose, typeof K][]) {
      const n = normalization(pose, k);
      const toCam = unit([-n.center[0], -n.center[1], -n.center[2]]);
      const { pitch, yaw } = vectorToAngles(mulVec(n.Rn, toCam)); // what the network should output
      const g = gazeFromModel(pitch, yaw, n.Rn, n.center);
      expect(Math.abs(g.h)).toBeLessThan(1e-9);
      expect(Math.abs(g.v)).toBeLessThan(1e-9);
    }
  });

  it("sign convention: looking to image right → h > 0, looking down → v > 0", () => {
    const c: Vec3 = [0, 0, 0.6];
    const right = cameraAngles(unit([0.3, 0, -1]), c), down = cameraAngles(unit([0, 0.3, -1]), c);
    expect(right.h).toBeGreaterThan(15);
    expect(Math.abs(right.v)).toBeLessThan(1e-9);
    expect(down.v).toBeGreaterThan(15);
    expect(Math.abs(down.h)).toBeLessThan(1e-9);
  });

  it("network output 'straight ahead' in the normalised frame = towards the camera", () => {
    const pose: Pose = { R: euler(0, 0), t: [0.15, 0, 0.6] };
    const n = normalization(pose, K);
    const g = gazeFromModel(0, 0, n.Rn, n.center);
    expect(Math.hypot(g.h, g.v)).toBeLessThan(1e-9);
    // positive model yaw (ptgaze) = looking to the subject's left = image left
    expect(gazeFromModel(0, 0.2, n.Rn, n.center).h).toBeLessThan(-10);
    // positive model pitch = up
    expect(gazeFromModel(0.2, 0, n.Rn, n.center).v).toBeLessThan(-10);
    expect(denormalize([0, 0, -1], n.Rn).every(Number.isFinite)).toBe(true);
  });

  it("head angles: facing the camera = 0 even off-centre; turning to image right = yaw > 0", () => {
    const t: Vec3 = [0.5, 0, 1.5];
    const c = faceCenter({ R: euler(0, 0), t });
    // face rotated so it looks back at the camera
    const yawToCam = Math.atan2(c[0], c[2]) * DEG;
    expect(Math.abs(headAngles(euler(yawToCam, 0), faceCenter({ R: euler(yawToCam, 0), t })).yaw)).toBeLessThan(1);
    // euler yaw > 0 turns the forward axis (-Z) towards -X = image left
    expect(headAngles(euler(-20, 0), [0, 0, 0.6]).yaw).toBeGreaterThan(19);
    expect(headAngles(euler(0, 15), [0, 0, 0.6]).pitch).toBeGreaterThan(14);
    expect(FACE_MODEL.length).toBe(468 * 3);
  });
});
