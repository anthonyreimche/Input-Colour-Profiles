// The profile menu the panel and the Library dialogue share: the embedded
// choice first, then the built-in profiles, then the person's own.

import type { LibraryEntry } from "./library";
import type { SelectGroup } from "./safelight";
import { EMBEDDED } from "./tokens";

export const MISSING_LABEL = "Missing profile";

/** File types the browser decodes; RAW photos take the camera's colour instead. */
const CONVERTIBLE = /\.(jpe?g|jfif|png|webp|avif|tiff?|ppm|pgm|pbm|pnm)$/i;

export const isConvertible = (filename: string) => CONVERTIBLE.test(filename);

export function profileGroups(
  entries: readonly LibraryEntry[],
  embeddedLabel: string,
  value: string,
): SelectGroup[] {
  const groups: SelectGroup[] = [
    { items: [{ value: EMBEDDED, label: embeddedLabel }] },
    { title: "Built-in", items: entries.filter((e) => !e.user).map((e) => ({ value: e.id, label: e.label })) },
  ];
  const own = entries.filter((e) => e.user);
  if (own.length) groups.push({ title: "Your profiles", items: own.map((e) => ({ value: e.id, label: e.label })) });
  if (value !== EMBEDDED && !entries.some((e) => e.id === value)) {
    groups.push({ items: [{ value, label: MISSING_LABEL, disabled: true }] });
  }
  return groups;
}
