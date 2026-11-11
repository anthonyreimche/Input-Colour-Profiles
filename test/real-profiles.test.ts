// @vitest-environment node
// Profiles as other software writes them, from the folder Windows keeps them
// in. Skipped where the files aren't there.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/profile";
import { builtInProfile } from "../src/spaces";
import { isSrgbTransform, transformFor } from "../src/transform";

const FOLDER = "C:/Windows/System32/spool/drivers/color";

const cases: [file: string, builtIn: string][] = [
  ["sRGB Color Space Profile.icm", "srgb"],
  ["AdobeRGB1998.icc", "adobe-rgb"],
  ["ProPhoto.icm", "prophoto-rgb"],
];

describe.each(cases)("%s", (file, builtIn) => {
  const path = join(FOLDER, file);
  it.skipIf(!existsSync(path))(`converts like the built-in ${builtIn}`, () => {
    const parsed = parseProfile(new Uint8Array(readFileSync(path)));
    if (!parsed.ok) throw new Error(parsed.error);
    const ours = transformFor(builtInProfile(builtIn)!);
    const theirs = transformFor(parsed.profile);
    theirs.toRec709.forEach((v, i) => expect(v).toBeCloseTo(ours.toRec709[i], 2));
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < theirs.trc[c].length; i += 64) expect(theirs.trc[c][i]).toBeCloseTo(ours.trc[c][i], 2);
    }
    expect(isSrgbTransform(theirs)).toBe(builtIn === "srgb");
  });
});
