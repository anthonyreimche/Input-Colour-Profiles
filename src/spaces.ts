// The profiles every photo can be given without a file: the four spaces
// Safelight exports to, Rec. 2020 and linear sRGB. Their colorants are the
// D50-adapted values Safelight writes into the profiles it embeds on export
// (Rec. 2020's are the ITU primaries adapted the same way, by Bradford), so a
// photo exported in a space and read back in converts to what it was.

import type { Curve, RgbProfile, Xyz } from "./profile";

type Colorants = readonly [Xyz, Xyz, Xyz];

const SRGB: Colorants = [
  [0.436026, 0.222478, 0.013926],
  [0.385098, 0.716899, 0.097091],
  [0.143088, 0.060623, 0.714172],
];
const DISPLAY_P3: Colorants = [
  [0.5151, 0.241181, -0.001049],
  [0.291962, 0.692238, 0.041882],
  [0.157149, 0.066581, 0.784356],
];
const ADOBE_RGB: Colorants = [
  [0.60972, 0.311103, 0.019473],
  [0.205262, 0.625671, 0.060884],
  [0.14923, 0.063226, 0.74483],
];
const PROPHOTO_RGB: Colorants = [
  [0.797667, 0.288037, 0.0],
  [0.135192, 0.711877, 0.0],
  [0.031353, 0.000086, 0.825188],
];
const REC2020: Colorants = [
  [0.673459, 0.279033, -0.001931],
  [0.165661, 0.675338, 0.029979],
  [0.125092, 0.045626, 0.797134],
];

const srgbCurve: Curve = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const adobeCurve: Curve = (v) => Math.pow(v, 563 / 256);
const rommCurve: Curve = (v) => (v < 1 / 32 ? v / 16 : Math.pow(v, 1.8));
const rec709Curve: Curve = (v) => (v < 0.081242858 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45));
const linearCurve: Curve = (v) => v;
const gamma = (g: number): Curve => (v) => Math.pow(v, g);

const rgb = (description: string, colorants: Colorants, curve: Curve): RgbProfile => ({
  kind: "rgb",
  description,
  colorants,
  curves: [curve, curve, curve],
});

export interface BuiltInProfile {
  id: string;
  label: string;
  profile: RgbProfile;
}

export const SRGB_ID = "srgb";

export const BUILT_IN_PROFILES: readonly BuiltInProfile[] = [
  { id: SRGB_ID, label: "sRGB", profile: rgb("sRGB", SRGB, srgbCurve) },
  { id: "display-p3", label: "Display P3", profile: rgb("Display P3", DISPLAY_P3, srgbCurve) },
  { id: "adobe-rgb", label: "Adobe RGB (1998)", profile: rgb("Adobe RGB (1998)", ADOBE_RGB, adobeCurve) },
  { id: "prophoto-rgb", label: "ProPhoto RGB", profile: rgb("ProPhoto RGB", PROPHOTO_RGB, rommCurve) },
  { id: "rec2020", label: "Rec. 2020", profile: rgb("Rec. 2020", REC2020, rec709Curve) },
  { id: "linear-srgb", label: "Linear sRGB", profile: rgb("Linear sRGB", SRGB, linearCurve) },
];

export function builtInProfile(id: string): RgbProfile | null {
  return BUILT_IN_PROFILES.find((p) => p.id === id)?.profile ?? null;
}

/** ISO/IEC 23091-2 codes, as an AVIF or HEIF `nclx` box carries them. */
export interface Nclx {
  primaries: number;
  transfer: number;
}

interface NclxPrimaries {
  name: string;
  colorants: Colorants;
  /** The transfer the space is named with alone. */
  usual: readonly number[];
}

const NCLX_PRIMARIES: Record<number, NclxPrimaries> = {
  1: { name: "sRGB", colorants: SRGB, usual: [13] },
  9: { name: "Rec. 2020", colorants: REC2020, usual: [1, 6, 14, 15] },
  12: { name: "Display P3", colorants: DISPLAY_P3, usual: [13] },
};

// PQ (16) and HLG (18) are HDR and left to the browser.
const NCLX_TRANSFER: Record<number, { name: string; curve: Curve }> = {
  1: { name: "Rec. 709 curve", curve: rec709Curve },
  4: { name: "gamma 2.2", curve: gamma(2.2) },
  5: { name: "gamma 2.8", curve: gamma(2.8) },
  6: { name: "Rec. 709 curve", curve: rec709Curve },
  8: { name: "linear", curve: linearCurve },
  13: { name: "sRGB curve", curve: srgbCurve },
  14: { name: "Rec. 709 curve", curve: rec709Curve },
  15: { name: "Rec. 709 curve", curve: rec709Curve },
};

export function nclxProfile({ primaries, transfer }: Nclx): RgbProfile | null {
  const space = NCLX_PRIMARIES[primaries];
  const curve = NCLX_TRANSFER[transfer];
  if (!space || !curve) return null;
  const name = space.usual.includes(transfer) ? space.name : `${space.name}, ${curve.name}`;
  return rgb(name, space.colorants, curve.curve);
}
