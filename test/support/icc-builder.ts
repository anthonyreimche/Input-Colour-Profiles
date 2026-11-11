// Builds small ICC profiles and image containers for the tests: a v2 RGB
// matrix/TRC profile from colorants and curve tags, a grey profile, and the
// smallest JPEG, PNG, WebP, TIFF and AVIF byte runs that carry a profile.

import { deflateSync } from "node:zlib";

export type Xyz = readonly [number, number, number];

const D50: Xyz = [0.964212, 1, 0.825188];

const s15f16 = (x: number) => Math.round(x * 65536);
const align4 = (n: number) => (n + 3) & ~3;
const sig = (s: string) => [...s].map((c) => c.charCodeAt(0));

function tagBytes(type: string, body: number[]): Uint8Array {
  return new Uint8Array([...sig(type), 0, 0, 0, 0, ...body]);
}

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const s32 = (v: number) => u32(v >>> 0);

export function xyzTag(xyz: Xyz): Uint8Array {
  return tagBytes("XYZ ", [...s32(s15f16(xyz[0])), ...s32(s15f16(xyz[1])), ...s32(s15f16(xyz[2]))]);
}

/** A 'curv' with one entry: a pure gamma, in u8.8. */
export function gammaCurv(gamma: number): Uint8Array {
  return tagBytes("curv", [...u32(1), ...u16(Math.round(gamma * 256))]);
}

/** A 'curv' with no entries: the identity. */
export function identityCurv(): Uint8Array {
  return tagBytes("curv", [...u32(0)]);
}

/** A tabulated 'curv' of `decode` (encoded → linear) at `n` points. */
export function tableCurv(decode: (x: number) => number, n = 1024): Uint8Array {
  const body = [...u32(n)];
  for (let i = 0; i < n; i++) body.push(...u16(Math.round(Math.min(1, Math.max(0, decode(i / (n - 1)))) * 65535)));
  return tagBytes("curv", body);
}

/** A 'para' of function type `fn` with its parameters, in s15.16. */
export function paraCurve(fn: number, params: number[]): Uint8Array {
  return tagBytes("para", [...u16(fn), 0, 0, ...params.flatMap((p) => s32(s15f16(p)))]);
}

export function descTag(text: string): Uint8Array {
  const ascii = [...text].map((c) => c.charCodeAt(0) & 0x7f);
  return tagBytes("desc", [...u32(ascii.length + 1), ...ascii, 0, ...new Array(4 + 4 + 2 + 1 + 67).fill(0)]);
}

export function mlucTag(text: string): Uint8Array {
  const utf16 = [...text].flatMap((c) => u16(c.charCodeAt(0)));
  return tagBytes("mluc", [...u32(1), ...u32(12), ...sig("en"), ...sig("US"), ...u32(utf16.length), ...u32(28), ...utf16]);
}

export interface ProfileSpec {
  colorSpace?: string;
  /** rXYZ, gXYZ, bXYZ, D50-adapted. */
  colorants?: readonly [Xyz, Xyz, Xyz];
  /** One curve shared by the three channels, or one each. */
  trc?: Uint8Array | readonly [Uint8Array, Uint8Array, Uint8Array];
  /** The grey profile's kTRC. */
  grayTrc?: Uint8Array;
  description?: Uint8Array;
  /** Extra tags, by signature. */
  extra?: Record<string, Uint8Array>;
  /** Leave tags out, by signature. */
  omit?: string[];
}

/** A v2 'mntr' profile with the tags `spec` asks for. */
export function buildProfile(spec: ProfileSpec): Uint8Array {
  const tags: [string, Uint8Array][] = [];
  if (spec.description) tags.push(["desc", spec.description]);
  tags.push(["wtpt", xyzTag(D50)]);
  if (spec.colorants) {
    tags.push(["rXYZ", xyzTag(spec.colorants[0])], ["gXYZ", xyzTag(spec.colorants[1])], ["bXYZ", xyzTag(spec.colorants[2])]);
  }
  if (spec.trc) {
    const [r, g, b] = spec.trc instanceof Uint8Array ? [spec.trc, spec.trc, spec.trc] : spec.trc;
    tags.push(["rTRC", r], ["gTRC", g], ["bTRC", b]);
  }
  if (spec.grayTrc) tags.push(["kTRC", spec.grayTrc]);
  for (const [key, data] of Object.entries(spec.extra ?? {})) tags.push([key, data]);
  const kept = tags.filter(([key]) => !spec.omit?.includes(key));

  const tableSize = 4 + kept.length * 12;
  let cursor = 128 + tableSize;
  const placed = new Map<Uint8Array, number>();
  for (const [, data] of kept) {
    if (placed.has(data)) continue;
    placed.set(data, cursor);
    cursor = align4(cursor + data.length);
  }
  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, cursor);
  view.setUint32(8, 0x02400000);
  out.set(sig("mntr"), 12);
  out.set(sig(spec.colorSpace ?? (spec.grayTrc ? "GRAY" : "RGB ")), 16);
  out.set(sig("XYZ "), 20);
  out.set(sig("acsp"), 36);
  view.setInt32(68, s15f16(D50[0]));
  view.setInt32(72, s15f16(D50[1]));
  view.setInt32(76, s15f16(D50[2]));
  view.setUint32(128, kept.length);
  kept.forEach(([key, data], i) => {
    const at = 132 + i * 12;
    out.set(sig(key), at);
    view.setUint32(at + 4, placed.get(data)!);
    view.setUint32(at + 8, data.length);
  });
  for (const [data, offset] of placed) out.set(data, offset);
  return out;
}

// ─── Containers ─────────────────────────────────────────────────────────────

const concat = (...parts: (Uint8Array | number[])[]) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};

/** A JPEG head: SOI, an Exif APP1, the profile in APP2 segments of at most
 *  `chunk` bytes each (written in `order`, 1-based), SOS and a few scan bytes. */
export function jpegWith(icc: Uint8Array | null, opts: { chunk?: number; order?: number[] } = {}): Uint8Array {
  const parts: (Uint8Array | number[])[] = [[0xff, 0xd8]];
  const exif = concat(sig("Exif"), [0, 0], new Uint8Array(20));
  parts.push([0xff, 0xe1, ...u16(exif.length + 2)], exif);
  if (icc) {
    const chunk = opts.chunk ?? 65519;
    const pieces: Uint8Array[] = [];
    for (let at = 0; at < icc.length; at += chunk) pieces.push(icc.subarray(at, at + chunk));
    const order = opts.order ?? pieces.map((_, i) => i + 1);
    for (const seq of order) {
      const body = concat(sig("ICC_PROFILE"), [0, seq, pieces.length], pieces[seq - 1]);
      parts.push([0xff, 0xe2, ...u16(body.length + 2)], body);
    }
  }
  parts.push([0xff, 0xda, 0, 2], [1, 2, 3, 0xff, 0xd9]);
  return concat(...parts);
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat(sig(type), data);
  return concat(u32(data.length), typed, u32(crc32(typed)));
}

export function pngWith(icc: Uint8Array | null): Uint8Array {
  const ihdr = concat(u32(1), u32(1), [8, 2, 0, 0, 0]);
  const chunks = [pngChunk("IHDR", ihdr)];
  if (icc) chunks.push(pngChunk("iCCP", concat(sig("Profile"), [0, 0], deflateSync(icc))));
  chunks.push(pngChunk("IDAT", deflateSync(new Uint8Array([0, 0, 0, 0]))), pngChunk("IEND", new Uint8Array()));
  return concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ...chunks);
}

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  return concat(sig(type), le32(data.length), data, data.length % 2 ? [0] : []);
}

export function webpWith(icc: Uint8Array | null): Uint8Array {
  const chunks = [riffChunk("VP8X", new Uint8Array([icc ? 0x20 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))];
  if (icc) chunks.push(riffChunk("ICCP", icc));
  chunks.push(riffChunk("VP8L", new Uint8Array([0x2f, 0, 0, 0, 0])));
  const body = concat(sig("WEBP"), ...chunks);
  return concat(sig("RIFF"), le32(body.length), body);
}

/** A TIFF with one IFD holding ImageWidth and, when given, the ICC tag, its
 *  data written after `gap` bytes of padding. */
export function tiffWith(icc: Uint8Array | null, opts: { littleEndian?: boolean; gap?: number } = {}): Uint8Array {
  const le = opts.littleEndian ?? true;
  const w16 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff] : u16(v));
  const w32 = (v: number) => (le ? le32(v) : u32(v));
  const entries = icc ? 2 : 1;
  const ifdEnd = 8 + 2 + entries * 12 + 4;
  const dataAt = ifdEnd + (opts.gap ?? 0);
  const ifd: number[] = [...w16(entries), ...w16(256), ...w16(3), ...w32(1), ...w16(1), 0, 0];
  if (icc) ifd.push(...w16(34675), ...w16(7), ...w32(icc.length), ...w32(dataAt));
  ifd.push(...w32(0));
  const head = le ? [0x49, 0x49, 42, 0, ...w32(8)] : [0x4d, 0x4d, 0, 42, ...w32(8)];
  return concat(head, ifd, new Uint8Array(opts.gap ?? 0), icc ?? []);
}

function box(type: string, ...body: (Uint8Array | number[])[]): Uint8Array {
  const data = concat(...body);
  return concat(u32(data.length + 8), sig(type), data);
}

export type ColrBox = { prof: Uint8Array } | { nclx: { primaries: number; transfer: number } };

/** An AVIF head: ftyp, then meta ▸ iprp ▸ ipco holding the colr boxes. */
export function avifWith(colr: ColrBox[], opts: { mdatFirst?: boolean } = {}): Uint8Array {
  const colrBoxes = colr.map((c) =>
    "prof" in c
      ? box("colr", sig("prof"), c.prof)
      : box("colr", sig("nclx"), u16(c.nclx.primaries), u16(c.nclx.transfer), u16(1), [0x80]),
  );
  const ipco = box("ipco", box("ispe", [0, 0, 0, 0], u32(1), u32(1)), ...colrBoxes);
  const meta = box("meta", [0, 0, 0, 0], box("hdlr", [0, 0, 0, 0], u32(0), sig("pict"), new Uint8Array(13)), box("iprp", ipco));
  const ftyp = box("ftyp", sig("avif"), u32(0), sig("mif1"), sig("avif"));
  const mdat = box("mdat", new Uint8Array(64));
  return opts.mdatFirst ? concat(ftyp, mdat, meta) : concat(ftyp, meta, mdat);
}
