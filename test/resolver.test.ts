// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProfileLibrary, type SettingsStore } from "../src/library";
import { createResolver, describeEmbedded } from "../src/resolver";
import { builtInProfile } from "../src/spaces";
import { tokenFor } from "../src/tokens";
import { transformFor } from "../src/transform";
import { avifWith, buildProfile, descTag, gammaCurv, jpegWith, tableCurv, type Xyz } from "./support/icc-builder";

const P3: readonly [Xyz, Xyz, Xyz] = [
  [0.5151, 0.241181, -0.001049],
  [0.291962, 0.692238, 0.041882],
  [0.157149, 0.066581, 0.784356],
];
const SRGB: readonly [Xyz, Xyz, Xyz] = [
  [0.436026, 0.222478, 0.013926],
  [0.385098, 0.716899, 0.097091],
  [0.143088, 0.060623, 0.714172],
];
const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const p3Icc = buildProfile({ colorants: P3, trc: tableCurv(srgbDecode), description: descTag("Display P3") });
const srgbIcc = buildProfile({ colorants: SRGB, trc: tableCurv(srgbDecode), description: descTag("sRGB IEC61966-2.1") });
const cmykIcc = buildProfile({ colorSpace: "CMYK", description: descTag("Coated FOGRA39") });

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);
const photo = (inputProfile?: string) => ({ id: "p1", filename: "a.jpg", inputProfile });

function memorySettings(): SettingsStore {
  const values = new Map<string, unknown>();
  return {
    get: <T,>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    set: (key, value) => void values.set(key, value),
  };
}

function rig(untagged = "srgb") {
  const library = new ProfileLibrary(memorySettings());
  const resolver = createResolver({ library, untaggedProfileId: () => untagged });
  return { library, resolver };
}

const matrixOf = (id: string) => transformFor(builtInProfile(id)!).toRec709;

function expectMatrix(actual: number[] | undefined, expected: number[]) {
  expect(actual).toBeDefined();
  actual!.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
}

describe("resolver", () => {
  it("converts from a wide embedded profile", async () => {
    const t = await rig().resolver.resolve(photo(), blob(jpegWith(p3Icc)));
    expectMatrix(t?.toRec709, matrixOf("display-p3"));
  });

  it("leaves an sRGB photo to the browser", async () => {
    expect(await rig().resolver.resolve(photo(), blob(jpegWith(srgbIcc)))).toBeNull();
  });

  it("leaves a profile it can't read, such as CMYK, to the browser", async () => {
    expect(await rig("adobe-rgb").resolver.resolve(photo(), blob(jpegWith(cmykIcc)))).toBeNull();
  });

  it("reads an untagged file as the untagged rule says", async () => {
    expect(await rig("srgb").resolver.resolve(photo(), blob(jpegWith(null)))).toBeNull();
    const t = await rig("adobe-rgb").resolver.resolve(photo(), blob(jpegWith(null)));
    expectMatrix(t?.toRec709, matrixOf("adobe-rgb"));
  });

  it("uses an assigned profile over the embedded one", async () => {
    const t = await rig().resolver.resolve(photo(tokenFor("prophoto-rgb")!), blob(jpegWith(p3Icc)));
    expectMatrix(t?.toRec709, matrixOf("prophoto-rgb"));
  });

  it("converts an sRGB assignment itself when the browser would apply the embedded profile", async () => {
    const t = await rig().resolver.resolve(photo(tokenFor("srgb")!), blob(jpegWith(p3Icc)));
    expectMatrix(t?.toRec709, matrixOf("srgb"));
    expect(await rig().resolver.resolve(photo(tokenFor("srgb")!), blob(jpegWith(srgbIcc)))).toBeNull();
    expect(await rig("adobe-rgb").resolver.resolve(photo(tokenFor("srgb")!), blob(jpegWith(null)))).toBeNull();
  });

  it("assigns over an embedded sRGB profile", async () => {
    const t = await rig().resolver.resolve(photo(tokenFor("display-p3")!), blob(jpegWith(srgbIcc)));
    expectMatrix(t?.toRec709, matrixOf("display-p3"));
  });

  it("ignores an assignment on a file whose own profile isn't RGB", async () => {
    expect(await rig().resolver.resolve(photo(tokenFor("adobe-rgb")!), blob(jpegWith(cmykIcc)))).toBeNull();
  });

  it("assigns a user profile", async () => {
    const { library, resolver } = rig();
    const added = await library.add(buildProfile({ colorants: P3, trc: gammaCurv(1.8) }), "x.icc");
    if (!added.ok) throw new Error(added.error);
    const t = await resolver.resolve(photo(tokenFor(added.entry.id)!), blob(jpegWith(null)));
    expectMatrix(t?.toRec709, matrixOf("display-p3"));
    expect(t?.trc[0][2048]).toBeCloseTo(Math.pow(2048 / 4095, 1.8), 2);
  });

  it("falls back to the embedded profile when an assigned one is gone", async () => {
    const t = await rig().resolver.resolve(photo(tokenFor("user:gone")!), blob(jpegWith(p3Icc)));
    expectMatrix(t?.toRec709, matrixOf("display-p3"));
  });

  it("reads AVIF nclx codes", async () => {
    const t = await rig().resolver.resolve(photo(), blob(avifWith([{ nclx: { primaries: 9, transfer: 14 } }])));
    expectMatrix(t?.toRec709, matrixOf("rec2020"));
    expect(await rig().resolver.resolve(photo(), blob(avifWith([{ nclx: { primaries: 9, transfer: 16 } }])))).toBeNull();
  });

  it("builds each profile's transform once", async () => {
    const { resolver } = rig();
    const a = await resolver.resolve(photo(), blob(jpegWith(p3Icc)));
    const b = await resolver.resolve({ ...photo(), id: "p2" }, blob(jpegWith(p3Icc)));
    expect(b).toBe(a);
  });
});

describe("describeEmbedded", () => {
  it("names the embedded profile", async () => {
    expect(await describeEmbedded(blob(jpegWith(p3Icc)))).toEqual({ kind: "profile", name: "Display P3" });
  });

  it("says when there is none", async () => {
    expect(await describeEmbedded(blob(jpegWith(null)))).toEqual({ kind: "none" });
  });

  it("names a profile it leaves to the browser, with the reason", async () => {
    expect(await describeEmbedded(blob(jpegWith(cmykIcc)))).toEqual({
      kind: "unsupported",
      name: "Coated FOGRA39",
      reason: "This profile isn't for RGB or greyscale images.",
    });
  });

  it("names nclx codes by their space", async () => {
    expect(await describeEmbedded(blob(avifWith([{ nclx: { primaries: 12, transfer: 13 } }])))).toEqual({
      kind: "profile",
      name: "Display P3",
    });
  });
});
