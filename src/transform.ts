// A profile as Safelight applies it on decode: each channel's curve as a
// table, then one matrix from the profile's linear RGB to linear Rec. 709,
// Safelight's working space. The matrix goes through the D50 connection space
// (relative colorimetric), the way ICC matrix/TRC profiles chain: the
// profile's colorants into XYZ, then sRGB's back out of it.

import type { Profile, Xyz } from "./profile";
import { builtInProfile, SRGB_ID } from "./spaces";

export const TRC_SAMPLES = 4096;

export interface InputTransform {
  /** Encoded [0,1] → linear, per channel, at TRC_SAMPLES even steps. */
  trc: [Float32Array, Float32Array, Float32Array];
  /** Profile-linear RGB → linear Rec. 709, row-major. */
  toRec709: number[];
}

type Mat3 = number[];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const columns = (r: Xyz, g: Xyz, b: Xyz): Mat3 => [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + col];
      out.push(sum);
    }
  }
  return out;
}

function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

const SRGB = builtInProfile(SRGB_ID)!;
const FROM_XYZ_TO_SRGB = invert(columns(...SRGB.colorants));

function tabulate(curve: (x: number) => number): Float32Array {
  const table = new Float32Array(TRC_SAMPLES);
  for (let i = 0; i < TRC_SAMPLES; i++) table[i] = curve(i / (TRC_SAMPLES - 1));
  return table;
}

export function transformFor(profile: Profile): InputTransform {
  const [r, g, b] = profile.curves;
  return {
    trc: [tabulate(r), tabulate(g), tabulate(b)],
    toRec709:
      profile.kind === "gray" ? [...IDENTITY] : multiply(FROM_XYZ_TO_SRGB, columns(...profile.colorants)),
  };
}

// Within these a profile converts every 8-bit code to within a fraction of a
// step of what sRGB gives, so the browser's own decode serves it.
const MATRIX_TOLERANCE = 2e-3;
const CURVE_TOLERANCE = 1e-3;

const SRGB_TRC = transformFor(SRGB).trc[0];

export function isSrgbTransform(t: InputTransform): boolean {
  if (t.toRec709.some((v, i) => Math.abs(v - IDENTITY[i]) > MATRIX_TOLERANCE)) return false;
  return t.trc.every((table) => table.every((v, i) => Math.abs(v - SRGB_TRC[i]) <= CURVE_TOLERANCE));
}
