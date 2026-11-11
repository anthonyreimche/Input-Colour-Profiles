// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PROFILE_ERROR, parseProfile } from "../src/profile";
import {
  buildProfile,
  descTag,
  gammaCurv,
  identityCurv,
  mlucTag,
  paraCurve,
  tableCurv,
  type Xyz,
} from "./support/icc-builder";

const ADOBE: readonly [Xyz, Xyz, Xyz] = [
  [0.60972, 0.311103, 0.019473],
  [0.205262, 0.625671, 0.060884],
  [0.14923, 0.063226, 0.74483],
];

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function parsed(bytes: Uint8Array) {
  const result = parseProfile(bytes);
  if (!result.ok) throw new Error(result.error);
  return result.profile;
}

describe("parseProfile", () => {
  it("reads the colorants of a matrix/TRC profile as written", () => {
    const profile = parsed(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2) }));
    expect(profile.kind).toBe("rgb");
    if (profile.kind !== "rgb") return;
    profile.colorants.forEach((xyz, i) => xyz.forEach((v, j) => expect(v).toBeCloseTo(ADOBE[i][j], 4)));
  });

  it("reads a one-entry curv as a gamma", () => {
    const { curves } = parsed(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.19921875) }));
    expect(curves[0](0.5)).toBeCloseTo(Math.pow(0.5, 2.19921875), 6);
    expect(curves[2](1)).toBeCloseTo(1, 6);
  });

  it("reads an empty curv as the identity", () => {
    const { curves } = parsed(buildProfile({ colorants: ADOBE, trc: identityCurv() }));
    expect(curves[1](0.3)).toBeCloseTo(0.3, 6);
  });

  it("interpolates a tabulated curv", () => {
    const { curves } = parsed(buildProfile({ colorants: ADOBE, trc: tableCurv(srgbDecode) }));
    for (const x of [0, 0.02, 0.2, 0.5, 0.77, 1]) expect(curves[0](x)).toBeCloseTo(srgbDecode(x), 4);
  });

  it("reads every parametric curve type", () => {
    const g = 2.4;
    const a = 1 / 1.055;
    const b = 0.055 / 1.055;
    const c = 1 / 12.92;
    const d = 0.04045;
    const cases: [number, number[], (x: number) => number][] = [
      [0, [2.2], (x) => Math.pow(x, 2.2)],
      [1, [g, a, b], (x) => (x >= -b / a ? Math.pow(a * x + b, g) : 0)],
      [2, [g, a, b, 0.01], (x) => (x >= -b / a ? Math.pow(a * x + b, g) + 0.01 : 0.01)],
      [3, [g, a, b, c, d], srgbDecode],
      [4, [g, a, b, c, d, 0.002, 0.001], (x) => (x >= d ? Math.pow(a * x + b, g) + 0.002 : c * x + 0.001)],
    ];
    for (const [fn, params, expected] of cases) {
      const { curves } = parsed(buildProfile({ colorants: ADOBE, trc: paraCurve(fn, params) }));
      for (const x of [0.01, 0.03, 0.2, 0.5, 0.9]) expect(curves[0](x)).toBeCloseTo(expected(x), 4);
    }
  });

  it("keeps a separate curve per channel", () => {
    const { curves } = parsed(
      buildProfile({ colorants: ADOBE, trc: [gammaCurv(1.8), gammaCurv(2.2), identityCurv()] }),
    );
    expect(curves[0](0.5)).toBeCloseTo(Math.pow(0.5, 1.8), 2);
    expect(curves[1](0.5)).toBeCloseTo(Math.pow(0.5, 2.2), 2);
    expect(curves[2](0.5)).toBeCloseTo(0.5, 6);
  });

  it("reads a v2 desc or a v4 mluc description", () => {
    expect(parsed(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2), description: descTag("Adobe RGB (1998)") })).description).toBe(
      "Adobe RGB (1998)",
    );
    expect(parsed(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2), description: mlucTag("Display P3") })).description).toBe(
      "Display P3",
    );
    expect(parsed(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2) })).description).toBe("");
  });

  it("reads a grey profile's kTRC for all three channels", () => {
    const profile = parsed(buildProfile({ grayTrc: gammaCurv(2.2) }));
    expect(profile.kind).toBe("gray");
    expect(profile.curves[0](0.5)).toBeCloseTo(Math.pow(0.5, 2.2), 2);
    expect(profile.curves[2](0.5)).toBeCloseTo(Math.pow(0.5, 2.2), 2);
  });

  it("refuses what isn't a profile", () => {
    expect(parseProfile(new Uint8Array(64))).toEqual({ ok: false, error: PROFILE_ERROR.notIcc });
    const bytes = buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2) });
    bytes[36] = 0;
    expect(parseProfile(bytes)).toEqual({ ok: false, error: PROFILE_ERROR.notIcc });
  });

  it("refuses a profile whose tag table runs past its end", () => {
    const bytes = buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2) });
    new DataView(bytes.buffer).setUint32(128, 9999);
    expect(parseProfile(bytes)).toEqual({ ok: false, error: PROFILE_ERROR.notIcc });
  });

  it("refuses CMYK and other colour spaces", () => {
    expect(parseProfile(buildProfile({ colorSpace: "CMYK", colorants: ADOBE, trc: gammaCurv(2.2) }))).toEqual({
      ok: false,
      error: PROFILE_ERROR.colorSpace,
    });
  });

  it("refuses an RGB profile without a matrix and tone curves", () => {
    expect(parseProfile(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2), omit: ["gTRC"] }))).toEqual({
      ok: false,
      error: PROFILE_ERROR.noMatrix,
    });
    expect(parseProfile(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2), omit: ["bXYZ"] }))).toEqual({
      ok: false,
      error: PROFILE_ERROR.noMatrix,
    });
  });

  it("refuses a tone curve type it can't read", () => {
    const bogus = new Uint8Array([0x73, 0x66, 0x33, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseProfile(buildProfile({ colorants: ADOBE, trc: bogus }))).toEqual({ ok: false, error: PROFILE_ERROR.curveType });
    expect(parseProfile(buildProfile({ colorants: ADOBE, trc: paraCurve(7, [1]) }))).toEqual({
      ok: false,
      error: PROFILE_ERROR.curveType,
    });
  });

  it("refuses colorants that don't describe red, green and blue", () => {
    const swapped: readonly [Xyz, Xyz, Xyz] = [ADOBE[1], ADOBE[0], ADOBE[2]];
    expect(parseProfile(buildProfile({ colorants: swapped, trc: gammaCurv(2.2) }))).toEqual({
      ok: false,
      error: PROFILE_ERROR.primaries,
    });
  });
});
