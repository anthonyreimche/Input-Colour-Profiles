// Input Colour Profiles, a Safelight extension (GPL-3.0-or-later).
//
// Reads the ICC profile a JPEG, PNG, WebP, AVIF or TIFF carries and has
// Safelight convert from it without clipping, so colour outside sRGB survives
// into the edit. A photo can be given another profile, files with none are
// read as a chosen profile, and matrix/TRC profiles of your own can be added.

import { AssignDialog, openAssignDialog } from "./AssignDialog";
import { createController, EXTENSION_ID, UNTAGGED_KEY, type Controller } from "./controller";
import { InputProfilePanel } from "./Panel";
import { React, initRuntime } from "./rt";
import type { SafelightAPI } from "./safelight";
import { SRGB_ID } from "./spaces";

export const PANEL_ID = `${EXTENSION_ID}.panel`;
export const MENU_ID = `${EXTENSION_ID}.assign`;
export const DIALOG_SLOT_ID = `${EXTENSION_ID}.dialog`;

let controller: Controller | null = null;

function registerSettings(host: SafelightAPI, active: Controller): void {
  host.registerSettings({
    fields: [
      {
        key: UNTAGGED_KEY,
        label: "Files without a profile",
        hint: "The profile a photo with no embedded profile is read as.",
        type: "select",
        default: SRGB_ID,
        options: active.entries().map((e) => ({ value: e.id, label: e.label })),
      },
    ],
  });
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  controller?.dispose();
  const active = createController(host);
  controller = active;

  host.develop.registerInputProfiles(active.resolver);
  registerSettings(host, active);
  active.subscribe(() => registerSettings(host, active));

  host.registerPanel({
    id: PANEL_ID,
    title: "Input Profile",
    component: () => <InputProfilePanel controller={active} />,
    defaultDock: { module: "develop", direction: "right" },
  });
  host.registerGridMenuItem({
    id: MENU_ID,
    label: (ids) => (ids.length > 1 ? `Assign input profile… (${ids.length})` : "Assign input profile…"),
    onClick: openAssignDialog,
  });
  host.registerSlot({
    id: DIALOG_SLOT_ID,
    slot: "library-toolbar",
    component: () => <AssignDialog controller={active} />,
  });
}

export function deactivate(): void {
  controller?.dispose();
  controller = null;
}
