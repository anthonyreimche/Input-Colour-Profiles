import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import manifest from "../safelight.json";
import { EXTENSION_ID, UNTAGGED_KEY } from "../src/controller";
import { activate, deactivate, DIALOG_SLOT_ID, MENU_ID, PANEL_ID } from "../src/index";
import { USER_PROFILES_KEY } from "../src/library";
import { fakeApi, type Rig } from "./support/fake-api";
import { buildProfile, descTag, gammaCurv, jpegWith, tableCurv, type Xyz } from "./support/icc-builder";

const P3: readonly [Xyz, Xyz, Xyz] = [
  [0.5151, 0.241181, -0.001049],
  [0.291962, 0.692238, 0.041882],
  [0.157149, 0.066581, 0.784356],
];
const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const p3Jpeg = jpegWith(buildProfile({ colorants: P3, trc: tableCurv(srgbDecode), description: descTag("Display P3") }));
const userIcc = buildProfile({ colorants: P3, trc: gammaCurv(1.8), description: descTag("Scanner Profile") });

const handleOf = (bytes: Uint8Array, name = "a.jpg") =>
  ({ getFile: async () => new File([bytes as Uint8Array<ArrayBuffer>], name) }) as unknown as FileSystemFileHandle;

function start(): Rig {
  const rig = fakeApi();
  activate(rig.api);
  return rig;
}

function Panel({ rig }: { rig: Rig }) {
  const C = rig.panels.find((p) => p.id === PANEL_ID)!.component;
  return <C />;
}

function DialogHost({ rig }: { rig: Rig }) {
  const C = rig.slots.find((s) => s.id === DIALOG_SLOT_ID)!.component;
  return <C />;
}

const menu = () => screen.getByLabelText<HTMLSelectElement>("Input profile");
const optionLabels = () => Array.from(menu().options, (o) => o.textContent);

afterEach(() => {
  cleanup();
  deactivate();
});

describe("activate", () => {
  it("uses the id safelight.json declares", () => {
    expect(EXTENSION_ID).toBe(manifest.id);
  });

  it("registers the resolver, the panel, the settings, the menu item and the dialogue host", () => {
    const rig = start();
    expect(rig.resolvers).toHaveLength(1);
    expect(rig.panels.map((p) => p.id)).toEqual([PANEL_ID]);
    expect(rig.menuItems.map((m) => m.id)).toEqual([MENU_ID]);
    expect(rig.slots.map((s) => s.id)).toEqual([DIALOG_SLOT_ID]);
    const field = rig.settingsSections.at(-1)!.fields[0];
    expect(field).toMatchObject({ key: UNTAGGED_KEY, type: "select", default: "srgb" });
  });

  it("has Safelight decode again when the untagged rule or the profile list changes", () => {
    const rig = start();
    rig.setSettingElsewhere(UNTAGGED_KEY, "adobe-rgb");
    rig.setSettingElsewhere(USER_PROFILES_KEY, []);
    rig.setSettingElsewhere("unrelated", 1);
    expect(rig.invalidations).toBe(2);
  });

  it("reads untagged files with the rule's profile", async () => {
    const rig = start();
    const file = new Blob([jpegWith(null) as Uint8Array<ArrayBuffer>]);
    expect(await rig.resolvers[0].resolve({ id: "p", filename: "a.jpg" }, file)).toBeNull();
    rig.setSettingElsewhere(UNTAGGED_KEY, "adobe-rgb");
    expect(await rig.resolvers[0].resolve({ id: "p", filename: "a.jpg" }, file)).not.toBeNull();
  });

  it("stops listening when deactivated", () => {
    const rig = start();
    deactivate();
    rig.setSettingElsewhere(UNTAGGED_KEY, "adobe-rgb");
    expect(rig.invalidations).toBe(0);
  });

  it("labels the menu item with the selection's size", () => {
    const item = start().menuItems[0];
    expect(typeof item.label === "function" && item.label(["a"])).toBe("Assign input profile…");
    expect(typeof item.label === "function" && item.label(["a", "b", "c"])).toBe("Assign input profile… (3)");
  });
});

describe("panel", () => {
  it("names the embedded profile and lists the built-in profiles", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    render(<Panel rig={rig} />);
    await waitFor(() => expect(optionLabels()[0]).toBe("Embedded: Display P3"));
    expect(optionLabels()).toEqual([
      "Embedded: Display P3",
      "sRGB",
      "Display P3",
      "Adobe RGB (1998)",
      "ProPhoto RGB",
      "Rec. 2020",
      "Linear sRGB",
    ]);
    expect(menu().value).toBe("embedded");
  });

  it("says how a file without a profile is read", async () => {
    const rig = start();
    rig.setSettingElsewhere(UNTAGGED_KEY, "adobe-rgb");
    rig.setPhotos([{ fileHandle: handleOf(jpegWith(null)) }]);
    render(<Panel rig={rig} />);
    await waitFor(() => expect(optionLabels()[0]).toBe("No profile: read as Adobe RGB (1998)"));
  });

  it("assigns the picked profile to the open photo, and Embedded clears it", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    render(<Panel rig={rig} />);
    const user = userEvent.setup();
    await user.selectOptions(menu(), "adobe-rgb");
    expect(rig.assigned.at(-1)).toEqual({ ids: ["p0"], token: "assign:adobe-rgb" });
    expect(menu().value).toBe("adobe-rgb");
    await user.selectOptions(menu(), "embedded");
    expect(rig.assigned.at(-1)).toEqual({ ids: ["p0"], token: null });
  });

  it("adds a profile of your own and gives it to the open photo", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    rig.nextFile = new File([userIcc as Uint8Array<ArrayBuffer>], "scanner.icc");
    render(<Panel rig={rig} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Add profile…" }));
    await waitFor(() => expect(optionLabels()).toContain("Scanner Profile"));
    expect(rig.assigned.at(-1)?.token).toMatch(/^assign:user:[0-9a-f]{40}$/);
    expect(rig.invalidations).toBe(1);
  });

  it("tells you why a file isn't a usable profile", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    rig.nextFile = new File([new Uint8Array(300)], "junk.icc");
    render(<Panel rig={rig} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Add profile…" }));
    await waitFor(() => expect(rig.alerts).toEqual(["This file isn't an ICC profile, or it's damaged."]));
    expect(rig.assigned).toEqual([]);
  });

  it("removes a profile of your own after asking, and says the photo falls back", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    rig.nextFile = new File([userIcc as Uint8Array<ArrayBuffer>], "scanner.icc");
    render(<Panel rig={rig} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add profile…" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(optionLabels()).not.toContain("Scanner Profile"));
    expect(optionLabels()).toContain("Missing profile");
    expect(screen.getByText(/it was removed, so the embedded profile is used/)).toBeTruthy();
  });

  it("keeps a profile when the removal is cancelled", async () => {
    const rig = start();
    rig.setPhotos([{ fileHandle: handleOf(p3Jpeg) }]);
    rig.nextFile = new File([userIcc as Uint8Array<ArrayBuffer>], "scanner.icc");
    rig.confirmAnswer = false;
    render(<Panel rig={rig} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add profile…" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(optionLabels()).toContain("Scanner Profile");
  });

  it("explains RAW photos and an empty Develop", () => {
    const rig = start();
    rig.setPhotos([{ filename: "DSC_0001.NEF" }]);
    const { unmount } = render(<Panel rig={rig} />);
    expect(screen.getByText(/RAW photos take their colour from the camera/)).toBeTruthy();
    unmount();
    rig.setPhotos([]);
    render(<Panel rig={rig} />);
    expect(screen.getByText("No photo is open.")).toBeTruthy();
  });

  it("disables the menu for a profile only the standard decode reads", async () => {
    const rig = start();
    const cmyk = jpegWith(buildProfile({ colorSpace: "CMYK", description: descTag("Coated FOGRA39") }));
    rig.setPhotos([{ fileHandle: handleOf(cmyk) }]);
    render(<Panel rig={rig} />);
    await waitFor(() => expect(menu().disabled).toBe(true));
    expect(screen.getByText(/Coated FOGRA39: This profile isn't for RGB or greyscale images/)).toBeTruthy();
  });
});

describe("Library dialogue", () => {
  it("assigns one profile to every targeted photo", async () => {
    const rig = start();
    rig.setPhotos([{}, {}, {}]);
    render(<DialogHost rig={rig} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => rig.menuItems[0].onClick(["p0", "p2"]));
    expect(screen.getByRole("dialog").textContent).toContain("Input profile for 2 photos");
    const user = userEvent.setup();
    await user.selectOptions(menu(), "prophoto-rgb");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(rig.assigned).toEqual([{ ids: ["p0", "p2"], token: "assign:prophoto-rgb" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Cancel and on Escape without assigning", async () => {
    const rig = start();
    render(<DialogHost rig={rig} />);
    const user = userEvent.setup();
    act(() => rig.menuItems[0].onClick(["p0"]));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => rig.menuItems[0].onClick(["p0"]));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rig.assigned).toEqual([]);
  });
});
