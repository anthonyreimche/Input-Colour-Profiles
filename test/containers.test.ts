// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readEmbedded } from "../src/containers";
import { avifWith, buildProfile, gammaCurv, jpegWith, pngWith, tiffWith, webpWith } from "./support/icc-builder";

const ICC = buildProfile({
  colorants: [
    [0.60972, 0.311103, 0.019473],
    [0.205262, 0.625671, 0.060884],
    [0.14923, 0.063226, 0.74483],
  ],
  trc: gammaCurv(2.2),
});

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

async function iccOf(bytes: Uint8Array): Promise<Uint8Array | null> {
  const embedded = await readEmbedded(blob(bytes));
  if (embedded === null) return null;
  if (embedded.kind !== "icc") throw new Error(`expected icc, got ${embedded.kind}`);
  return embedded.bytes;
}

describe("readEmbedded", () => {
  it("reads a JPEG's profile from one APP2 segment", async () => {
    expect(await iccOf(jpegWith(ICC))).toEqual(ICC);
  });

  it("joins a JPEG profile split over several segments, in sequence order", async () => {
    expect(await iccOf(jpegWith(ICC, { chunk: 100 }))).toEqual(ICC);
    const count = Math.ceil(ICC.length / 100);
    const shuffled = Array.from({ length: count }, (_, i) => count - i);
    expect(await iccOf(jpegWith(ICC, { chunk: 100, order: shuffled }))).toEqual(ICC);
  });

  it("gives null for a JPEG with a missing segment", async () => {
    const count = Math.ceil(ICC.length / 100);
    const order = Array.from({ length: count }, (_, i) => i + 1).filter((n) => n !== 2);
    expect(await readEmbedded(blob(jpegWith(ICC, { chunk: 100, order })))).toBeNull();
  });

  it("gives null for a JPEG without a profile", async () => {
    expect(await readEmbedded(blob(jpegWith(null)))).toBeNull();
  });

  it("inflates a PNG's iCCP chunk", async () => {
    expect(await iccOf(pngWith(ICC))).toEqual(ICC);
    expect(await readEmbedded(blob(pngWith(null)))).toBeNull();
  });

  it("gives null for a PNG whose iCCP doesn't inflate", async () => {
    const png = pngWith(ICC);
    const at = png.findIndex((_, i) => String.fromCharCode(...png.subarray(i, i + 4)) === "iCCP");
    png.fill(0x55, at + 14, at + 30);
    expect(await readEmbedded(blob(png))).toBeNull();
  });

  it("reads a WebP's ICCP chunk", async () => {
    expect(await iccOf(webpWith(ICC))).toEqual(ICC);
    expect(await readEmbedded(blob(webpWith(null)))).toBeNull();
  });

  it("reads a TIFF's ICC tag in either byte order, wherever its data sits", async () => {
    expect(await iccOf(tiffWith(ICC))).toEqual(ICC);
    expect(await iccOf(tiffWith(ICC, { littleEndian: false }))).toEqual(ICC);
    expect(await iccOf(tiffWith(ICC, { gap: 6 * 1024 * 1024 }))).toEqual(ICC);
    expect(await readEmbedded(blob(tiffWith(null)))).toBeNull();
  });

  it("reads an AVIF's colr profile, preferring it to nclx", async () => {
    expect(await iccOf(avifWith([{ prof: ICC }]))).toEqual(ICC);
    expect(await iccOf(avifWith([{ nclx: { primaries: 12, transfer: 13 } }, { prof: ICC }]))).toEqual(ICC);
  });

  it("reads an AVIF's nclx codes, with the metadata after the image data", async () => {
    expect(await readEmbedded(blob(avifWith([{ nclx: { primaries: 12, transfer: 13 } }], { mdatFirst: true })))).toEqual({
      kind: "nclx",
      primaries: 12,
      transfer: 13,
    });
  });

  it("gives null, never throws, for other or damaged files", async () => {
    expect(await readEmbedded(blob(new Uint8Array([1, 2, 3])))).toBeNull();
    expect(await readEmbedded(blob(new Uint8Array(0)))).toBeNull();
    const cut = jpegWith(ICC);
    expect(await readEmbedded(blob(cut.subarray(0, 40)))).toBeNull();
    const tiff = tiffWith(ICC);
    expect(await readEmbedded(blob(tiff.subarray(0, 30)))).toBeNull();
    const avif = avifWith([{ prof: ICC }]);
    new DataView(avif.buffer).setUint32(0, 0xffffff00);
    expect(await readEmbedded(blob(avif))).toBeNull();
  });
});
