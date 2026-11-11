// The extension's state and actions, shared by the panel, the Library dialogue
// and activate(): the profile library, the resolver Safelight asks on every
// decode, and the settings that change what it answers. Whatever changes the
// answer for a photo without changing its token (the untagged rule, a profile
// added or removed, here or in another window) tells Safelight to decode again.

import { ProfileLibrary, USER_PROFILES_KEY, type AddResult, type LibraryEntry } from "./library";
import { createResolver, type Resolver } from "./resolver";
import type { SafelightAPI } from "./safelight";
import { SRGB_ID } from "./spaces";
import { tokenFor } from "./tokens";

export const EXTENSION_ID = "input-colour-profiles";
export const UNTAGGED_KEY = "untagged";

/** A user profile bigger than this is a LUT profile Safelight would only read
 *  the matrix of; settings live in the window's storage, so it isn't kept. */
export const MAX_PROFILE_BYTES = 1024 * 1024;

export const TOO_BIG = "This profile is over 1 MB. Safelight reads only a profile's matrix and tone curves, so use a matrix profile.";

export interface Controller {
  library: ProfileLibrary;
  resolver: Resolver;
  untagged(): string;
  /** Profiles for a menu, built-in first. */
  entries(): readonly LibraryEntry[];
  assign(ids: string[], value: string): Promise<void>;
  addFromFile(file: File): Promise<AddResult>;
  remove(id: string): void;
  subscribe(listener: () => void): () => void;
  /** Moves whenever entries() or untagged() may have changed. */
  revision(): number;
  dispose(): void;
}

export function createController(api: SafelightAPI): Controller {
  const library = new ProfileLibrary(api.settings);
  const untagged = () => {
    const id = api.settings.get(UNTAGGED_KEY, SRGB_ID);
    return library.get(id) ? id : SRGB_ID;
  };
  const resolver = createResolver({ library, untaggedProfileId: untagged });
  const listeners = new Set<() => void>();
  let revision = 0;

  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };

  const stop = api.settings.onChange((key) => {
    if (key === USER_PROFILES_KEY) library.reload();
    if (key !== USER_PROFILES_KEY && key !== UNTAGGED_KEY) return;
    api.develop.invalidateInputProfiles();
    changed();
  });

  return {
    library,
    resolver,
    untagged,
    entries: () => library.list(),
    assign: (ids, value) => api.catalog.setInputProfile(ids, tokenFor(value)),
    async addFromFile(file) {
      if (file.size > MAX_PROFILE_BYTES) return { ok: false, error: TOO_BIG };
      return library.add(new Uint8Array(await file.arrayBuffer()), file.name);
    },
    remove: (id) => library.remove(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    revision: () => revision,
    dispose() {
      stop();
      listeners.clear();
    },
  };
}
