import { describe, expect, it } from "vitest";
import { MEAN, STD, tensorToRGBA, warpToTensor } from "./warp";

// 4×4 RGBA test image: R = 10·x, G = 10·y, B = 200
const W = 4, H = 4;
const img = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set([10 * x, 10 * y, 200, 255], (y * W + x) * 4);
const val = (t: Float32Array, c: number, u: number, v: number, size: number) => t[c * size * size + v * size + u] * STD[c] * 255 + MEAN[c] * 255;

describe("warpToTensor", () => {
  it("identity map copies pixels and normalises RGB with ImageNet mean/std", () => {
    const t = warpToTensor(img, W, H, [1, 0, 0, 0, 1, 0, 0, 0, 1], 4);
    expect(val(t, 0, 3, 1, 4)).toBeCloseTo(30, 3);
    expect(val(t, 1, 3, 1, 4)).toBeCloseTo(10, 3);
    expect(val(t, 2, 0, 0, 4)).toBeCloseTo(200, 3);
    expect(t[0]).toBeCloseTo((0 / 255 - MEAN[0]) / STD[0], 5);
  });

  it("bilinear between pixels, black outside (cv2 BORDER_CONSTANT)", () => {
    // shift by half a pixel
    const t = warpToTensor(img, W, H, [1, 0, 0.5, 0, 1, 0, 0, 0, 1], 4);
    expect(val(t, 0, 1, 0, 4)).toBeCloseTo(15, 3);
    // last column samples x = 3.5: half from x = 3 (30), half from outside (0)
    expect(val(t, 0, 3, 0, 4)).toBeCloseTo(15, 3);
    expect(val(t, 2, 3, 0, 4)).toBeCloseTo(100, 3);
    // far outside → black
    const out = warpToTensor(img, W, H, [1, 0, 100, 0, 1, 0, 0, 0, 1], 4);
    expect(val(out, 2, 0, 0, 4)).toBeCloseTo(0, 3);
  });

  it("homography with scale (2× downsample) and round trip to RGBA", () => {
    const t = warpToTensor(img, W, H, [2, 0, 0, 0, 2, 0, 0, 0, 1], 2);
    expect(val(t, 0, 1, 1, 2)).toBeCloseTo(20, 3);
    expect(val(t, 1, 1, 1, 2)).toBeCloseTo(20, 3);
    const rgba = tensorToRGBA(t, 2);
    expect([rgba[12], rgba[13], rgba[14], rgba[15]]).toEqual([20, 20, 200, 255]);
  });
});
