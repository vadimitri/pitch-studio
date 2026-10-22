// Pure image warp for the gaze model: perspective-sample an RGBA bitmap into the 224×224 normalised face patch and
// turn it into the network input. Mirrors ptgaze: cv2.warpPerspective (bilinear, black border) on the BGR frame,
// then BGR→RGB, /255, ImageNet mean/std (ptgaze/transforms.py _create_ethxgaze_transform). Browser pixels are RGB already.
import type { Mat3 } from "./geometry";

export const MEAN = [0.485, 0.456, 0.406];
export const STD = [0.229, 0.224, 0.225];

/** dst (size×size) ← src through M (dst pixel → src pixel, row-major 3×3). Output: CHW Float32 RGB, normalised.
 *  Pixel (i, j) is sampled at integer coordinates (OpenCV convention); taps outside the source count as black. */
export function warpToTensor(src: ArrayLike<number>, sw: number, sh: number, M: Mat3, size = 224, out = new Float32Array(3 * size * size)): Float32Array {
  const plane = size * size;
  const k0 = 1 / (255 * STD[0]), k1 = 1 / (255 * STD[1]), k2 = 1 / (255 * STD[2]);
  const o0 = -MEAN[0] / STD[0], o1 = -MEAN[1] / STD[1], o2 = -MEAN[2] / STD[2];
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const w = M[6] * u + M[7] * v + M[8];
      const x = (M[0] * u + M[1] * v + M[2]) / w, y = (M[3] * u + M[4] * v + M[5]) / w;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      let r = 0, g = 0, b = 0;
      if (xi >= -1 && yi >= -1 && xi < sw && yi < sh) {
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const inX0 = xi >= 0, inX1 = xi + 1 < sw, inY0 = yi >= 0, inY1 = yi + 1 < sh;
        if (inY0) {
          const row = yi * sw;
          if (inX0) { const p = (row + xi) * 4; r += w00 * src[p]; g += w00 * src[p + 1]; b += w00 * src[p + 2]; }
          if (inX1) { const p = (row + xi + 1) * 4; r += w10 * src[p]; g += w10 * src[p + 1]; b += w10 * src[p + 2]; }
        }
        if (inY1) {
          const row = (yi + 1) * sw;
          if (inX0) { const p = (row + xi) * 4; r += w01 * src[p]; g += w01 * src[p + 1]; b += w01 * src[p + 2]; }
          if (inX1) { const p = (row + xi + 1) * 4; r += w11 * src[p]; g += w11 * src[p + 1]; b += w11 * src[p + 2]; }
        }
      }
      const i = v * size + u;
      // cv2 writes uint8: round like the reference pipeline does
      out[i] = Math.round(r) * k0 + o0;
      out[plane + i] = Math.round(g) * k1 + o1;
      out[2 * plane + i] = Math.round(b) * k2 + o2;
    }
  }
  return out;
}

/** Inverse of the normalisation, for debug views: CHW tensor → RGBA bytes. */
export function tensorToRGBA(t: Float32Array, size = 224): Uint8ClampedArray {
  const plane = size * size, out = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    out[i * 4] = (t[i] * STD[0] + MEAN[0]) * 255;
    out[i * 4 + 1] = (t[plane + i] * STD[1] + MEAN[1]) * 255;
    out[i * 4 + 2] = (t[2 * plane + i] * STD[2] + MEAN[2]) * 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}
