// An ICC profile reduced to what an input conversion needs: an RGB profile's
// D50-adapted colorants and three tone curves, or a grey profile's one curve.
// Matrix/TRC profiles qualify; a LUT-based profile is read through the matrix
// and curves it carries beside its LUTs, and refused when it has none.

export type Xyz = readonly [number, number, number];

/** Encoded [0,1] → linear. */
export type Curve = (x: number) => number;

export type Curves = readonly [Curve, Curve, Curve];

export interface RgbProfile {
  kind: "rgb";
  /** The profile's own name; empty when it carries none. */
  description: string;
  /** rXYZ, gXYZ and bXYZ: D50-adapted, as the ICC specifies. */
  colorants: readonly [Xyz, Xyz, Xyz];
  curves: Curves;
}

export interface GrayProfile {
  kind: "gray";
  description: string;
  /** The kTRC, once per channel. */
  curves: Curves;
}

export type Profile = RgbProfile | GrayProfile;

export type ParsedProfile = { ok: true; profile: Profile } | { ok: false; error: string };

export const PROFILE_ERROR = {
  notIcc: "This file isn't an ICC profile, or it's damaged.",
  colorSpace: "This profile isn't for RGB or greyscale images.",
  noMatrix:
    'This profile has no matrix and tone curves. Profiles made as "curves + matrix" or "single curve + matrix" work.',
  noGrayCurve: "This greyscale profile has no tone curve.",
  curveType: "This profile uses a tone curve type Safelight can't read.",
  primaries:
    "This profile's primaries don't describe red, green and blue. Profiles built with a swapped matrix aren't supported.",
} as const;

interface Tag {
  offset: number;
  size: number;
}

const HEADER_SIZE = 128;
const MAX_DESCRIPTION = 256;
// Parameters per parametricCurveType function (ICC.1 10.18).
const PARA_PARAMS = [1, 3, 4, 5, 7];

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function readTagTable(bytes: Uint8Array, view: DataView, size: number): Map<string, Tag> | null {
  const count = view.getUint32(HEADER_SIZE);
  if (HEADER_SIZE + 4 + count * 12 > size) return null;
  const tags = new Map<string, Tag>();
  for (let i = 0; i < count; i++) {
    const entry = HEADER_SIZE + 4 + i * 12;
    const tag = { offset: view.getUint32(entry + 4), size: view.getUint32(entry + 8) };
    if (tag.offset + tag.size > size) return null;
    tags.set(fourcc(bytes, entry), tag);
  }
  return tags;
}

function readXyz(bytes: Uint8Array, view: DataView, tag: Tag): Xyz | null {
  if (tag.size < 20 || fourcc(bytes, tag.offset) !== "XYZ ") return null;
  const at = tag.offset + 8;
  return [view.getInt32(at) / 65536, view.getInt32(at + 4) / 65536, view.getInt32(at + 8) / 65536];
}

/** The tag's curve, or the reason it can't be read. */
function readCurve(bytes: Uint8Array, view: DataView, tag: Tag): Curve | string {
  const at = tag.offset;
  if (tag.size < 12) return PROFILE_ERROR.notIcc;
  const type = fourcc(bytes, at);
  if (type === "curv") {
    const n = view.getUint32(at + 8);
    if (tag.size < 12 + n * 2) return PROFILE_ERROR.notIcc;
    if (n === 0) return (x) => x;
    if (n === 1) {
      const gamma = view.getUint16(at + 12) / 256;
      return (x) => Math.pow(x, gamma);
    }
    const table = Array.from({ length: n }, (_, i) => view.getUint16(at + 12 + i * 2) / 65535);
    return (x) => {
      const p = clamp01(x) * (n - 1);
      const i = Math.min(n - 2, Math.floor(p));
      return table[i] + (table[i + 1] - table[i]) * (p - i);
    };
  }
  if (type !== "para") return PROFILE_ERROR.curveType;
  const fn = view.getUint16(at + 8);
  const count = PARA_PARAMS[fn];
  if (count === undefined) return PROFILE_ERROR.curveType;
  if (tag.size < 12 + count * 4) return PROFILE_ERROR.notIcc;
  const [g, a, b, c, d, e, f] = Array.from({ length: count }, (_, i) => view.getInt32(at + 12 + i * 4) / 65536);
  switch (fn) {
    case 0:
      return (x) => Math.pow(x, g);
    case 1:
      return (x) => (x >= -b / a ? Math.pow(a * x + b, g) : 0);
    case 2:
      return (x) => (x >= -b / a ? Math.pow(a * x + b, g) + c : c);
    case 3:
      return (x) => (x >= d ? Math.pow(a * x + b, g) : c * x);
    default:
      return (x) => (x >= d ? Math.pow(a * x + b, g) + e : c * x + f);
  }
}

function readDescription(bytes: Uint8Array, view: DataView, tag: Tag | undefined): string {
  if (!tag || tag.size < 12) return "";
  const at = tag.offset;
  let text = "";
  const type = fourcc(bytes, at);
  if (type === "desc") {
    const n = view.getUint32(at + 8);
    if (12 + n > tag.size) return "";
    for (let i = 0; i < Math.min(n, MAX_DESCRIPTION); i++) text += String.fromCharCode(bytes[at + 12 + i]);
  } else if (type === "mluc") {
    if (tag.size < 28 || view.getUint32(at + 8) < 1) return "";
    const length = Math.min(view.getUint32(at + 20), MAX_DESCRIPTION * 2);
    const start = view.getUint32(at + 24);
    if (start + length > tag.size) return "";
    for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(at + start + i));
  }
  return text.split("\0")[0].trim();
}

function chromaticity([x, y, z]: Xyz): [number, number] {
  const sum = x + y + z;
  return sum > 0 ? [x / sum, y / sum] : [NaN, NaN];
}

// Red sits furthest along x, green highest in y, blue lowest in y. A swapped
// matrix fails this on purpose.
function plausiblePrimaries(r: Xyz, g: Xyz, b: Xyz): boolean {
  const [rx, ry] = chromaticity(r);
  const [gx, gy] = chromaticity(g);
  const [bx, by] = chromaticity(b);
  return rx > gx && rx > bx && gy > ry && gy > by && by < ry;
}

function readCurves(
  bytes: Uint8Array,
  view: DataView,
  tags: readonly Tag[],
): readonly Curve[] | string {
  const curves: Curve[] = [];
  for (const tag of tags) {
    const curve = readCurve(bytes, view, tag);
    if (typeof curve === "string") return curve;
    curves.push(curve);
  }
  return curves;
}

/** The profile's own name, read even from one parseProfile refuses; empty
 *  when it carries none or isn't a profile. */
export function profileDescription(bytes: Uint8Array): string {
  if (bytes.length < HEADER_SIZE + 4) return "";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0);
  if (fourcc(bytes, 36) !== "acsp" || size > bytes.length) return "";
  const tags = readTagTable(bytes, view, size);
  return tags ? readDescription(bytes, view, tags.get("desc")) : "";
}

export function parseProfile(bytes: Uint8Array): ParsedProfile {
  const fail = (error: string): ParsedProfile => ({ ok: false, error });
  if (bytes.length < HEADER_SIZE + 4) return fail(PROFILE_ERROR.notIcc);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0);
  if (fourcc(bytes, 36) !== "acsp" || size < HEADER_SIZE + 4 || size > bytes.length) return fail(PROFILE_ERROR.notIcc);
  const tags = readTagTable(bytes, view, size);
  if (!tags) return fail(PROFILE_ERROR.notIcc);
  const description = readDescription(bytes, view, tags.get("desc"));
  const space = fourcc(bytes, 16);

  if (space === "GRAY") {
    const tag = tags.get("kTRC");
    if (!tag) return fail(PROFILE_ERROR.noGrayCurve);
    const curve = readCurve(bytes, view, tag);
    if (typeof curve === "string") return fail(curve);
    return { ok: true, profile: { kind: "gray", description, curves: [curve, curve, curve] } };
  }
  if (space !== "RGB ") return fail(PROFILE_ERROR.colorSpace);

  const colorantTags = ["rXYZ", "gXYZ", "bXYZ"].map((s) => tags.get(s));
  const curveTags = ["rTRC", "gTRC", "bTRC"].map((s) => tags.get(s));
  if (colorantTags.some((t) => !t) || curveTags.some((t) => !t)) return fail(PROFILE_ERROR.noMatrix);
  const colorants: Xyz[] = [];
  for (const tag of colorantTags as Tag[]) {
    const xyz = readXyz(bytes, view, tag);
    if (!xyz) return fail(PROFILE_ERROR.notIcc);
    colorants.push(xyz);
  }
  const curves = readCurves(bytes, view, curveTags as Tag[]);
  if (typeof curves === "string") return fail(curves);
  const [r, g, b] = colorants;
  if (!plausiblePrimaries(r, g, b)) return fail(PROFILE_ERROR.primaries);
  return {
    ok: true,
    profile: { kind: "rgb", description, colorants: [r, g, b], curves: [curves[0], curves[1], curves[2]] },
  };
}
