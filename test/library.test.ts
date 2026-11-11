// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProfileLibrary, type SettingsStore } from "../src/library";
import { PROFILE_ERROR } from "../src/profile";
import { ASSIGN_PREFIX, EMBEDDED, parseToken, tokenFor } from "../src/tokens";
import { buildProfile, descTag, gammaCurv, type Xyz } from "./support/icc-builder";

const ADOBE: readonly [Xyz, Xyz, Xyz] = [
  [0.60972, 0.311103, 0.019473],
  [0.205262, 0.625671, 0.060884],
  [0.14923, 0.063226, 0.74483],
];

function memorySettings(): SettingsStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T,>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    set: (key, value) => void values.set(key, value),
  };
}

const camera = buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2), description: descTag("Studio Camera") });

describe("tokens", () => {
  it("reads a missing token or 'embedded' as the embedded profile", () => {
    expect(parseToken(undefined)).toEqual({ kind: "embedded" });
    expect(parseToken(EMBEDDED)).toEqual({ kind: "embedded" });
    expect(parseToken("something else")).toEqual({ kind: "embedded" });
  });

  it("round-trips an assigned profile id", () => {
    expect(tokenFor("adobe-rgb")).toBe(`${ASSIGN_PREFIX}adobe-rgb`);
    expect(parseToken(tokenFor("user:abc")!)).toEqual({ kind: "assign", profileId: "user:abc" });
  });

  it("stores the embedded choice as no token at all", () => {
    expect(tokenFor(EMBEDDED)).toBeNull();
  });
});

describe("ProfileLibrary", () => {
  it("lists the built-in profiles", () => {
    const library = new ProfileLibrary(memorySettings());
    expect(library.list().map((e) => e.id)).toEqual([
      "srgb",
      "display-p3",
      "adobe-rgb",
      "prophoto-rgb",
      "rec2020",
      "linear-srgb",
    ]);
    expect(library.get("adobe-rgb")?.label).toBe("Adobe RGB (1998)");
    expect(library.get("missing")).toBeNull();
  });

  it("adds a user profile under its content hash, named by its description", async () => {
    const settings = memorySettings();
    const library = new ProfileLibrary(settings);
    const added = await library.add(camera, "camera.icc");
    if (!added.ok) throw new Error(added.error);
    expect(added.entry.id).toMatch(/^user:[0-9a-f]{40}$/);
    expect(added.entry.label).toBe("Studio Camera");
    expect(added.entry.user).toBe(true);
    expect(library.list().at(-1)?.id).toBe(added.entry.id);

    const reopened = new ProfileLibrary(settings);
    expect(reopened.get(added.entry.id)?.label).toBe("Studio Camera");
    expect(reopened.get(added.entry.id)?.profile.kind).toBe("rgb");
  });

  it("names a profile without a description after its file", async () => {
    const library = new ProfileLibrary(memorySettings());
    const added = await library.add(buildProfile({ colorants: ADOBE, trc: gammaCurv(2.2) }), "My Scanner.icm");
    expect(added.ok && added.entry.label).toBe("My Scanner");
  });

  it("refuses a file it can't use, with the parser's reason", async () => {
    const library = new ProfileLibrary(memorySettings());
    expect(await library.add(new Uint8Array(200), "junk.icc")).toEqual({ ok: false, error: PROFILE_ERROR.notIcc });
    expect(library.list()).toHaveLength(6);
  });

  it("adds the same profile once", async () => {
    const library = new ProfileLibrary(memorySettings());
    const first = await library.add(camera, "a.icc");
    const second = await library.add(camera, "b.icc");
    expect(first.ok && second.ok && second.entry.id === first.entry.id).toBe(true);
    expect(library.list()).toHaveLength(7);
  });

  it("removes a user profile, never a built-in one", async () => {
    const settings = memorySettings();
    const library = new ProfileLibrary(settings);
    const added = await library.add(camera, "a.icc");
    if (!added.ok) throw new Error(added.error);
    library.remove("srgb");
    library.remove(added.entry.id);
    expect(library.get(added.entry.id)).toBeNull();
    expect(library.get("srgb")).not.toBeNull();
    expect(new ProfileLibrary(settings).get(added.entry.id)).toBeNull();
  });

  it("skips stored entries that no longer parse", () => {
    const settings = memorySettings();
    settings.values.set("userProfiles", [{ id: "user:bad", label: "Bad", data: "AAAA" }, "nonsense"]);
    expect(new ProfileLibrary(settings).list()).toHaveLength(6);
  });

  it("reloads when the stored list changes in another window", async () => {
    const settings = memorySettings();
    const library = new ProfileLibrary(settings);
    const other = new ProfileLibrary(settings);
    const added = await other.add(camera, "a.icc");
    if (!added.ok) throw new Error(added.error);
    expect(library.get(added.entry.id)).toBeNull();
    library.reload();
    expect(library.get(added.entry.id)?.label).toBe("Studio Camera");
  });
});
