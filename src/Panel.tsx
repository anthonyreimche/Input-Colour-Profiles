// The Develop panel: what profile the open photo carries, the profile it is
// read with, and adding a profile of your own.

import type { Controller } from "./controller";
import { profileGroups, isConvertible, MISSING_LABEL } from "./menu";
import { describeEmbedded, type EmbeddedDescription } from "./resolver";
import { React, api } from "./rt";
import type { CatalogPhoto } from "./safelight";
import { EMBEDDED, valueOf } from "./tokens";

export function useController(controller: Controller): number {
  return React.useSyncExternalStore(controller.subscribe, controller.revision);
}

/** What the open photo's file carries, read once per photo. */
function useEmbedded(photo: CatalogPhoto | undefined): EmbeddedDescription | null {
  const [found, setFound] = React.useState<{ id: string; description: EmbeddedDescription } | null>(null);
  const id = photo?.id;
  React.useEffect(() => {
    if (!photo?.fileHandle || !isConvertible(photo.filename)) return;
    let live = true;
    photo.fileHandle
      .getFile()
      .then(describeEmbedded)
      .then((description) => live && setFound({ id: photo.id, description }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return found && found.id === id ? found.description : null;
}

export function embeddedLabel(embedded: EmbeddedDescription | null, untaggedLabel: string): string {
  if (!embedded) return "Embedded profile";
  if (embedded.kind === "none") return `No profile: read as ${untaggedLabel}`;
  return `Embedded: ${embedded.name}`;
}

export function InputProfilePanel({ controller }: { controller: Controller }) {
  useController(controller);
  const { Select, Button, Field, Stack, Row, tokens, alertDialog, confirmDialog } = api.ui;
  const photo = api.catalog.useActivePhoto();
  const embedded = useEmbedded(photo);
  const note = (text: string) => <div style={{ padding: 8, color: tokens.textMuted, fontSize: 11 }}>{text}</div>;

  if (!photo) return note("No photo is open.");
  if (!isConvertible(photo.filename)) return note("RAW photos take their colour from the camera, not from a profile.");

  const value = valueOf(photo.inputProfile);
  const entries = controller.entries();
  const untaggedLabel = controller.library.get(controller.untagged())?.label ?? "sRGB";
  const groups = profileGroups(entries, embeddedLabel(embedded, untaggedLabel), value);
  const selected = entries.find((e) => e.id === value);
  const unsupported = embedded?.kind === "unsupported";
  const missing = value !== EMBEDDED && !selected;

  const hint = unsupported
    ? `${embedded.name}: ${embedded.reason} Safelight's standard decode shows this photo.`
    : missing
      ? `${MISSING_LABEL}: it was removed, so the embedded profile is used.`
      : undefined;

  async function add() {
    const file = await api.presets.pickFile(".icc,.icm");
    if (!file) return;
    const added = await controller.addFromFile(file);
    if (!added.ok) {
      await alertDialog({ title: "Couldn't add this profile", message: added.error });
      return;
    }
    if (photo) await controller.assign([photo.id], added.entry.id);
  }

  async function remove() {
    if (!selected?.user) return;
    const sure = await confirmDialog({
      title: `Remove ${selected.label}?`,
      message: "Photos given this profile go back to their embedded profile.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (sure) controller.remove(selected.id);
  }

  return (
    <div style={{ padding: 8 }}>
      <Stack gap={8}>
        <Field label="Input profile" hint={hint}>
          <Select
            value={value}
            groups={groups}
            disabled={unsupported}
            ariaLabel="Input profile"
            onChange={(next) => void controller.assign([photo.id], next)}
          />
        </Field>
        <Row gap={6}>
          <Button size="sm" variant="secondary" onClick={() => void add()}>
            Add profile…
          </Button>
          {selected?.user ? (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Remove
            </Button>
          ) : null}
        </Row>
      </Stack>
    </div>
  );
}
