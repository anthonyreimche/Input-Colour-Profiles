// A photo's choice, as Safelight stores it on the photo (CatalogPhoto.
// inputProfile): no token for "convert from the embedded profile", or
// "assign:<profile id>" for a profile the person picked.

export const EMBEDDED = "embedded";
export const ASSIGN_PREFIX = "assign:";

export type Choice = { kind: "embedded" } | { kind: "assign"; profileId: string };

export function parseToken(token: string | undefined): Choice {
  if (token?.startsWith(ASSIGN_PREFIX) && token.length > ASSIGN_PREFIX.length) {
    return { kind: "assign", profileId: token.slice(ASSIGN_PREFIX.length) };
  }
  return { kind: "embedded" };
}

/** The token for a menu value: EMBEDDED or a profile id. */
export function tokenFor(value: string): string | null {
  return value === EMBEDDED ? null : `${ASSIGN_PREFIX}${value}`;
}

/** The menu value for a photo's token. */
export function valueOf(token: string | undefined): string {
  const choice = parseToken(token);
  return choice.kind === "assign" ? choice.profileId : EMBEDDED;
}
