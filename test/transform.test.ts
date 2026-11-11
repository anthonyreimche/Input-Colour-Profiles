// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseProfile, type Profile } from "../src/profile";
import { BUILT_IN_PROFILES, builtInProfile, nclxProfile } from "../src/spaces";
import { TRC_SAMPLES, isSrgbTransform, transformFor, type InputTransform } from "../src/transform";
import { buildProfile, gammaCurv, tableCurv } from "./support/icc-builder";

type Row3 = [number, number, number];

const apply = (m: number[], v: Row3): Row3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

function multiply(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return out;
}

const expectIdentity = (m: number[], digits: number) =>
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, digits));

// Safelight core's sRGB-linear → output-linear matrices (color-space.ts),
// row-major: converting in should undo converting out.
const CORE_OUT: Record<string, number[]> = {
  "display-p3": [0.82246197, 0.17753803, 0.0, 0.0331942, 0.9668058, 0.0, 0.01708263, 0.07239744, 0.91051993],
  "adobe-rgb": [0.71512561, 0.28487439, 0.0, 0.0, 1.0, 0.0, 0.0, 0.04116195, 0.95883805],
  "prophoto-rgb": [
    0.529293, 0.33011615, 0.14059085, 0.09836009, 0.87346992, 0.02816999, 0.01687612, 0.11765874, 0.86546514,
  ],
};

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function transformOf(id: string): InputTransform {
  const profile = builtInProfile(id);
  if (!profile) throw new Error(`no built-in ${id}`);
  return transformFor(profile);
}

describe("transformFor", () => {
  it("is the identity for sRGB", () => {
    const t = transformOf("srgb");
    expectIdentity(t.toRec709, 6);
    expect(isSrgbTransform(t)).toBe(true);
  });

  it("undoes the core's conversion out to each wide space", () => {
    for (const [id, out] of Object.entries(CORE_OUT)) expectIdentity(multiply(out, transformOf(id).toRec709), 3);
  });

  it("maps white to white for every built-in profile", () => {
    for (const { id } of BUILT_IN_PROFILES) {
      apply(transformOf(id).toRec709, [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 4));
    }
  });

  it("keeps a colour outside sRGB as a negative channel", () => {
    const [r] = apply(transformOf("prophoto-rgb").toRec709, [0, 1, 0]);
    expect(r).toBeLessThan(-0.2);
    const [, g] = apply(transformOf("display-p3").toRec709, [1, 0, 0]);
    expect(g).toBeLessThan(-0.03);
  });

  it("tabulates each channel's curve, encoded to linear, at TRC_SAMPLES points", () => {
    const t = transformOf("adobe-rgb");
    expect(t.trc).toHaveLength(3);
    for (const table of t.trc) {
      expect(table).toBeInstanceOf(Float32Array);
      expect(table).toHaveLength(TRC_SAMPLES);
      expect(table[0]).toBe(0);
      expect(table[TRC_SAMPLES - 1]).toBeCloseTo(1, 6);
    }
    expect(t.trc[1][TRC_SAMPLES / 2]).toBeCloseTo(Math.pow(0.5, 2.19921875), 3);
  });

  it("uses the built-in transfer functions", () => {
    const at = (id: string, x: number) => transformOf(id).trc[0][Math.round(x * (TRC_SAMPLES - 1))];
    expect(at("display-p3", 0.5)).toBeCloseTo(srgbDecode(0.5), 3);
    expect(at("linear-srgb", 0.5)).toBeCloseTo(0.5, 3);
    expect(at("prophoto-rgb", 0.5)).toBeCloseTo(Math.pow(0.5, 1.8), 3);
    expect(at("prophoto-rgb", 0.02)).toBeCloseTo(0.02 / 16, 4);
    expect(at("rec2020", 0.05)).toBeCloseTo(0.05 / 4.5, 4);
    expect(at("rec2020", 0.5)).toBeCloseTo(Math.pow((0.5 + 0.099) / 1.099, 1 / 0.45), 3);
  });

  it("treats a file's own sRGB profile as sRGB", () => {
    const parsed = parseProfile(
      buildProfile({
        colorants: [
          [0.4361, 0.2225, 0.0139],
          [0.3851, 0.7169, 0.0971],
          [0.1431, 0.0606, 0.7141],
        ],
        trc: tableCurv(srgbDecode),
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(isSrgbTransform(transformFor(parsed.profile))).toBe(true);
  });

  it("is not sRGB for a wide space, a different curve or linear light", () => {
    expect(isSrgbTransform(transformOf("display-p3"))).toBe(false);
    expect(isSrgbTransform(transformOf("linear-srgb"))).toBe(false);
    const gamma22: Profile = { ...builtInProfile("srgb")!, curves: [(x) => x ** 2.2, (x) => x ** 2.2, (x) => x ** 2.2] };
    expect(isSrgbTransform(transformFor(gamma22))).toBe(false);
  });

  it("gives a grey profile the identity matrix and its curve on every channel", () => {
    const parsed = parseProfile(buildProfile({ grayTrc: gammaCurv(2.2) }));
    if (!parsed.ok) throw new Error(parsed.error);
    const t = transformFor(parsed.profile);
    expectIdentity(t.toRec709, 9);
    const mid = TRC_SAMPLES / 2;
    for (const table of t.trc) expect(table[mid]).toBeCloseTo(Math.pow(0.5, 2.2), 2);
  });
});

describe("built-in profiles", () => {
  it("lists sRGB first, then the wide spaces and linear sRGB", () => {
    expect(BUILT_IN_PROFILES.map((p) => p.id)).toEqual([
      "srgb",
      "display-p3",
      "adobe-rgb",
      "prophoto-rgb",
      "rec2020",
      "linear-srgb",
    ]);
    expect(builtInProfile("nope")).toBeNull();
  });

  it("reads AVIF/HEIF nclx codes for the spaces it knows", () => {
    expect(nclxProfile({ primaries: 12, transfer: 13 })?.colorants).toEqual(builtInProfile("display-p3")?.colorants);
    expect(nclxProfile({ primaries: 9, transfer: 14 })?.colorants).toEqual(builtInProfile("rec2020")?.colorants);
    expect(isSrgbTransform(transformFor(nclxProfile({ primaries: 1, transfer: 13 })!))).toBe(true);
    const linear = transformFor(nclxProfile({ primaries: 1, transfer: 8 })!);
    expect(linear.trc[0][TRC_SAMPLES / 2]).toBeCloseTo(0.5, 3);
  });

  it("leaves HDR transfers and unknown primaries to the browser", () => {
    expect(nclxProfile({ primaries: 9, transfer: 16 })).toBeNull();
    expect(nclxProfile({ primaries: 9, transfer: 18 })).toBeNull();
    expect(nclxProfile({ primaries: 11, transfer: 13 })).toBeNull();
    expect(nclxProfile({ primaries: 2, transfer: 13 })).toBeNull();
  });
});
