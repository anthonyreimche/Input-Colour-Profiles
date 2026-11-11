// Works out a photo's effective profile and the transform Safelight decodes it
// with. An assigned profile wins; else the embedded one; else the profile the
// untagged rule names. Whatever comes out as sRGB, or can't be read here (a
// CMYK or LUT-only profile, an HDR transfer), goes back to the browser's own
// decode, which handles it as it always has.

import { readEmbedded, type Embedded } from "./containers";
import { sha1Hex, type ProfileLibrary } from "./library";
import { parseProfile, profileDescription, type Profile } from "./profile";
import { nclxProfile } from "./spaces";
import { parseToken } from "./tokens";
import { isSrgbTransform, transformFor, type InputTransform } from "./transform";

export interface ResolverPhoto {
  id: string;
  filename: string;
  inputProfile?: string;
}

export interface Resolver {
  resolve(photo: ResolverPhoto, file: Blob): Promise<InputTransform | null>;
}

export interface ResolverDeps {
  library: ProfileLibrary;
  untaggedProfileId(): string;
}

/** A profile and the key its transform is kept under. */
interface Effective {
  key: string;
  profile: Profile | null;
}

const MEMO_LIMIT = 32;

async function fromEmbedded(embedded: Embedded): Promise<Effective> {
  if (embedded.kind === "nclx") {
    return { key: `nclx:${embedded.primaries}/${embedded.transfer}`, profile: nclxProfile(embedded) };
  }
  const parsed = parseProfile(embedded.bytes);
  return { key: `icc:${await sha1Hex(embedded.bytes)}`, profile: parsed.ok ? parsed.profile : null };
}

interface Memo {
  transform: InputTransform;
  srgb: boolean;
}

export function createResolver({ library, untaggedProfileId }: ResolverDeps): Resolver {
  const memo = new Map<string, Memo>();

  function remember({ key, profile }: { key: string; profile: Profile }): Memo {
    const known = memo.get(key);
    if (known) return known;
    const transform = transformFor(profile);
    const entry = { transform, srgb: isSrgbTransform(transform) };
    if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
    memo.set(key, entry);
    return entry;
  }

  const fromId = (id: string) => {
    const entry = library.get(id);
    return entry ? { key: `id:${entry.id}`, profile: entry.profile } : null;
  };

  return {
    async resolve(photo, file) {
      const embedded = await readEmbedded(file);
      const own: Effective | null = embedded ? await fromEmbedded(embedded) : null;
      // A profile only the browser can read (CMYK, LUT-only) stays the
      // browser's, assignment or not: the file's codes aren't RGB to assign to.
      if (own && !own.profile) return null;
      const ownMemo = own?.profile ? remember({ key: own.key, profile: own.profile }) : null;
      const choice = parseToken(photo.inputProfile);
      const picked =
        (choice.kind === "assign" ? fromId(choice.profileId) : null) ?? (own?.profile ? null : fromId(untaggedProfileId()));
      const result = picked ? remember(picked) : ownMemo;
      if (!result) return null;
      // The browser reads an untagged file, and converts an sRGB-tagged one, as
      // sRGB: then an sRGB result is exactly its decode.
      const browserIsSrgb = !ownMemo || ownMemo.srgb;
      return result.srgb && browserIsSrgb ? null : result.transform;
    },
  };
}

export type EmbeddedDescription =
  | { kind: "none" }
  | { kind: "profile"; name: string }
  | { kind: "unsupported"; name: string; reason: string };

/** What the file carries, in words, for the panel. */
export async function describeEmbedded(file: Blob): Promise<EmbeddedDescription> {
  const embedded = await readEmbedded(file);
  if (!embedded) return { kind: "none" };
  if (embedded.kind === "nclx") {
    const profile = nclxProfile(embedded);
    return profile
      ? { kind: "profile", name: profile.description }
      : { kind: "unsupported", name: "Colour codes", reason: "They describe HDR or a space this extension doesn't read." };
  }
  const parsed = parseProfile(embedded.bytes);
  const name = profileDescription(embedded.bytes) || "Unnamed profile";
  return parsed.ok ? { kind: "profile", name } : { kind: "unsupported", name, reason: parsed.error };
}
