// Finds the colour profile an image file carries: the ICC bytes of a JPEG
// (APP2, possibly split over several segments), PNG (iCCP), WebP (ICCP),
// TIFF (tag 34675) or AVIF/HEIF (a colr box), or the nclx codes an AVIF or
// HEIF may give instead. The file is read in pieces as its structure points,
// so a profile late in a large TIFF costs one small read. A damaged or
// unknown file gives null, never an error.

import type { Nclx } from "./spaces";

export type Embedded = { kind: "icc"; bytes: Uint8Array } | ({ kind: "nclx" } & Nclx);

interface Source {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

class Truncated extends Error {}

function sourceOf(file: Blob): Source {
  return {
    size: file.size,
    async read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > file.size) throw new Truncated();
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}

const text = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) => ((b[at + 3] << 24) | (b[at + 2] << 16) | (b[at + 1] << 8) | b[at]) >>> 0;

function joined(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const icc = (bytes: Uint8Array): Embedded => ({ kind: "icc", bytes });

// ─── JPEG ───────────────────────────────────────────────────────────────────

const ICC_MARKER = "ICC_PROFILE\0";
const SOS = 0xda;
const EOI = 0xd9;

async function fromJpeg(src: Source): Promise<Embedded | null> {
  const pieces = new Map<number, Uint8Array>();
  let count = 0;
  let at = 2;
  while (at + 4 <= src.size) {
    const head = await src.read(at, 4);
    if (head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === SOS || marker === EOI) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = u16be(head, 2);
    if (length < 2) return null;
    if (marker === 0xe2 && length >= 2 + ICC_MARKER.length + 2) {
      const body = await src.read(at + 4, length - 2);
      if (text(body, 0, ICC_MARKER.length) === ICC_MARKER) {
        const seq = body[ICC_MARKER.length];
        count = body[ICC_MARKER.length + 1];
        pieces.set(seq, body.subarray(ICC_MARKER.length + 2));
      }
    }
    at += 2 + length;
  }
  if (count === 0) return null;
  const ordered: Uint8Array[] = [];
  for (let seq = 1; seq <= count; seq++) {
    const piece = pieces.get(seq);
    if (!piece) return null;
    ordered.push(piece);
  }
  return icc(joined(ordered));
}

// ─── PNG ────────────────────────────────────────────────────────────────────

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fromPng(src: Source): Promise<Embedded | null> {
  let at = 8;
  while (at + 8 <= src.size) {
    const head = await src.read(at, 8);
    const length = u32be(head, 0);
    const type = text(head, 4, 4);
    if (type === "IDAT" || type === "IEND") return null;
    if (type === "iCCP") {
      const data = await src.read(at + 8, length);
      const nul = data.indexOf(0);
      if (nul < 1 || data[nul + 1] !== 0) return null;
      return icc(await inflate(data.subarray(nul + 2)));
    }
    at += 12 + length;
  }
  return null;
}

// ─── WebP ───────────────────────────────────────────────────────────────────

async function fromWebp(src: Source): Promise<Embedded | null> {
  let at = 12;
  while (at + 8 <= src.size) {
    const head = await src.read(at, 8);
    const length = u32le(head, 4);
    if (text(head, 0, 4) === "ICCP") return icc(await src.read(at + 8, length));
    at += 8 + length + (length % 2);
  }
  return null;
}

// ─── TIFF ───────────────────────────────────────────────────────────────────

const ICC_TAG = 34675;

async function fromTiff(src: Source, littleEndian: boolean): Promise<Embedded | null> {
  const r16 = (b: Uint8Array, at: number) => (littleEndian ? b[at] | (b[at + 1] << 8) : u16be(b, at));
  const r32 = (b: Uint8Array, at: number) => (littleEndian ? u32le(b, at) : u32be(b, at));
  const ifd = r32(await src.read(4, 4), 0);
  const count = r16(await src.read(ifd, 2), 0);
  const entries = await src.read(ifd + 2, count * 12);
  for (let i = 0; i < count; i++) {
    const entry = i * 12;
    if (r16(entries, entry) !== ICC_TAG) continue;
    const length = r32(entries, entry + 4);
    return length > 4 ? icc(await src.read(r32(entries, entry + 8), length)) : null;
  }
  return null;
}

// ─── AVIF / HEIF ────────────────────────────────────────────────────────────

interface Box {
  type: string;
  /** Where the box's contents start, after its header. */
  start: number;
  end: number;
}

async function boxesIn(src: Source, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const head = await src.read(at, 8);
    let size = u32be(head, 0);
    let header = 8;
    if (size === 1) {
      const large = await src.read(at + 8, 8);
      size = u32be(large, 0) * 2 ** 32 + u32be(large, 4);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) throw new Truncated();
    boxes.push({ type: text(head, 4, 4), start: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

async function child(src: Source, parent: Box, type: string, skip = 0): Promise<Box | null> {
  return (await boxesIn(src, parent.start + skip, parent.end)).find((b) => b.type === type) ?? null;
}

async function fromIsoBmff(src: Source): Promise<Embedded | null> {
  const meta = (await boxesIn(src, 0, src.size)).find((b) => b.type === "meta");
  if (!meta) return null;
  const iprp = await child(src, meta, "iprp", 4);
  const ipco = iprp && (await child(src, iprp, "ipco"));
  if (!ipco) return null;
  let nclx: Embedded | null = null;
  for (const box of await boxesIn(src, ipco.start, ipco.end)) {
    if (box.type !== "colr" || box.end - box.start < 4) continue;
    const kind = text(await src.read(box.start, 4), 0, 4);
    if (kind === "prof" || kind === "rICC") return icc(await src.read(box.start + 4, box.end - box.start - 4));
    if (kind === "nclx" && !nclx && box.end - box.start >= 8) {
      const codes = await src.read(box.start + 4, 4);
      nclx = { kind: "nclx", primaries: u16be(codes, 0), transfer: u16be(codes, 2) };
    }
  }
  return nclx;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function readEmbedded(file: Blob): Promise<Embedded | null> {
  if (file.size < 12) return null;
  const src = sourceOf(file);
  try {
    const head = await src.read(0, 12);
    if (head[0] === 0xff && head[1] === 0xd8) return await fromJpeg(src);
    if (u32be(head, 0) === 0x89504e47) return await fromPng(src);
    if (text(head, 0, 4) === "RIFF" && text(head, 8, 4) === "WEBP") return await fromWebp(src);
    if (text(head, 0, 4) === "II*\0") return await fromTiff(src, true);
    if (text(head, 0, 4) === "MM\0*") return await fromTiff(src, false);
    if (text(head, 4, 4) === "ftyp") return await fromIsoBmff(src);
    return null;
  } catch {
    return null;
  }
}
