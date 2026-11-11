// The profiles a photo can be given: the built-in ones, then the person's own,
// kept in the extension's settings (so every window sees the same list) as
// base64 under the SHA-1 of their bytes.

import { parseProfile, profileDescription, type Profile } from "./profile";
import { BUILT_IN_PROFILES } from "./spaces";

export interface SettingsStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

export interface LibraryEntry {
  id: string;
  label: string;
  profile: Profile;
  user: boolean;
}

interface StoredProfile {
  id: string;
  label: string;
  data: string;
}

export const USER_PROFILES_KEY = "userProfiles";
const USER_PREFIX = "user:";

export type AddResult = { ok: true; entry: LibraryEntry } | { ok: false; error: string };

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const isStored = (value: unknown): value is StoredProfile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as StoredProfile).id === "string" &&
  typeof (value as StoredProfile).label === "string" &&
  typeof (value as StoredProfile).data === "string";

const BUILT_IN_ENTRIES: readonly LibraryEntry[] = BUILT_IN_PROFILES.map(({ id, label, profile }) => ({
  id,
  label,
  profile,
  user: false,
}));

export class ProfileLibrary {
  private userEntries: LibraryEntry[] = [];

  constructor(private readonly settings: SettingsStore) {
    this.reload();
  }

  /** Reads the stored list again, after it changed in another window. */
  reload(): void {
    this.userEntries = [];
    for (const stored of this.stored()) {
      const bytes = fromBase64(stored.data);
      const parsed = bytes && parseProfile(bytes);
      if (parsed?.ok) this.userEntries.push({ id: stored.id, label: stored.label, profile: parsed.profile, user: true });
    }
  }

  list(): readonly LibraryEntry[] {
    return [...BUILT_IN_ENTRIES, ...this.userEntries];
  }

  get(id: string): LibraryEntry | null {
    return this.list().find((e) => e.id === id) ?? null;
  }

  async add(bytes: Uint8Array, fileName: string): Promise<AddResult> {
    const parsed = parseProfile(bytes);
    if (!parsed.ok) return parsed;
    const id = `${USER_PREFIX}${await sha1Hex(bytes)}`;
    const existing = this.get(id);
    if (existing) return { ok: true, entry: existing };
    const label = profileDescription(bytes) || fileName.replace(/\.(icc|icm)$/i, "");
    this.settings.set(USER_PROFILES_KEY, [...this.stored(), { id, label, data: toBase64(bytes) }]);
    this.reload();
    return { ok: true, entry: this.get(id)! };
  }

  remove(id: string): void {
    if (!id.startsWith(USER_PREFIX)) return;
    this.settings.set(
      USER_PROFILES_KEY,
      this.stored().filter((s) => s.id !== id),
    );
    this.reload();
  }

  private stored(): StoredProfile[] {
    const value = this.settings.get<unknown>(USER_PROFILES_KEY, []);
    return Array.isArray(value) ? value.filter(isStored) : [];
  }
}
