// A stand-in Safelight API for unit tests, over real React. It has only what
// this extension uses: reading any other member throws, naming it, so a test
// shows what to add here when the extension starts using more.
//
// The catalogue is a small store of photos, one of them open; setInputProfile
// writes the token onto it, as Safelight does. Core's Select is a native
// <select>, so tests drive it with user-event.

import * as React from "react";
import { createPortal } from "react-dom";
import type {
  ButtonProps,
  CatalogPhoto,
  FieldProps,
  GridMenuItemContribution,
  PanelContribution,
  RowProps,
  SafelightAPI,
  SelectProps,
  SettingsContribution,
  SlotContribution,
  StackProps,
} from "../../src/safelight";
import { EXTENSION_ID } from "../../src/controller";

type Resolver = Parameters<SafelightAPI["develop"]["registerInputProfiles"]>[0];

type FakeMembers = Pick<
  SafelightAPI,
  | "version"
  | "extensionId"
  | "react"
  | "reactDom"
  | "settings"
  | "registerPanel"
  | "registerSettings"
  | "registerGridMenuItem"
  | "registerSlot"
> & {
  develop: Pick<SafelightAPI["develop"], "registerInputProfiles" | "invalidateInputProfiles">;
  catalog: Pick<SafelightAPI["catalog"], "useActivePhoto" | "setInputProfile">;
  presets: Pick<SafelightAPI["presets"], "pickFile">;
  ui: Pick<SafelightAPI["ui"], "Select" | "Button" | "Field" | "Stack" | "Row" | "tokens" | "alertDialog" | "confirmDialog">;
};

export interface Rig {
  api: SafelightAPI;
  panels: PanelContribution[];
  settingsSections: SettingsContribution[];
  menuItems: GridMenuItemContribution[];
  slots: SlotContribution[];
  resolvers: Resolver[];
  invalidations: number;
  /** setInputProfile calls, in order. */
  assigned: { ids: string[]; token: string | null }[];
  alerts: string[];
  /** What the next confirmDialog answers. */
  confirmAnswer: boolean;
  /** What the next pickFile gives. */
  nextFile: File | null;
  setPhotos(photos: Partial<CatalogPhoto>[], activeId?: string): void;
  photo(id: string): CatalogPhoto | undefined;
  /** Change a setting as another window would. */
  setSettingElsewhere(key: string, value: unknown): void;
}

const TOKENS = new Proxy({}, { get: (_, key) => `var(--${String(key)})` }) as SafelightAPI["ui"]["tokens"];

function Select({ value, onChange, options, groups, disabled, ariaLabel }: SelectProps) {
  const items = groups ? groups.flatMap((g) => g.items) : (options ?? []);
  return React.createElement(
    "select",
    { value, disabled, "aria-label": ariaLabel, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) },
    items.map((o) => React.createElement("option", { key: o.value, value: o.value, disabled: o.disabled }, o.label)),
  );
}

const Button = ({ variant: _v, size: _s, active: _a, full: _f, ...rest }: ButtonProps) => React.createElement("button", rest);
const Field = ({ label, hint, children }: FieldProps) =>
  React.createElement("label", null, label, children, hint ? React.createElement("small", null, hint) : null);
const Stack = ({ children }: StackProps) => React.createElement("div", null, children);
const Row = ({ children }: RowProps) => React.createElement("div", null, children);

export function fakeApi(): Rig {
  const settings = new Map<string, unknown>();
  const settingListeners = new Set<(key: string, value: unknown) => void>();
  let photos: CatalogPhoto[] = [];
  let activeId: string | undefined;
  const photoListeners = new Set<() => void>();
  const emitPhotos = () => photoListeners.forEach((l) => l());

  const rig: Rig = {
    api: undefined as unknown as SafelightAPI,
    panels: [],
    settingsSections: [],
    menuItems: [],
    slots: [],
    resolvers: [],
    invalidations: 0,
    assigned: [],
    alerts: [],
    confirmAnswer: true,
    nextFile: null,
    setPhotos(next, id) {
      photos = next.map((p, i) => ({ id: `p${i}`, filename: `photo${i}.jpg`, fileHandle: null, ...p }) as CatalogPhoto);
      activeId = id ?? photos[0]?.id;
      emitPhotos();
    },
    photo: (id) => photos.find((p) => p.id === id),
    setSettingElsewhere(key, value) {
      settings.set(key, value);
      settingListeners.forEach((l) => l(key, value));
    },
  };

  function useActivePhoto(): CatalogPhoto | undefined {
    return React.useSyncExternalStore(
      (l) => {
        photoListeners.add(l);
        return () => void photoListeners.delete(l);
      },
      () => photos.find((p) => p.id === activeId),
    );
  }

  const members: FakeMembers = {
    version: 1,
    extensionId: EXTENSION_ID,
    react: React,
    reactDom: { createPortal },
    settings: {
      get: <T,>(key: string, fallback: T) => (settings.has(key) ? (settings.get(key) as T) : fallback),
      set: (key, value) => rig.setSettingElsewhere(key, value),
      onChange(cb) {
        settingListeners.add(cb);
        return () => void settingListeners.delete(cb);
      },
    },
    registerPanel: (c) => void rig.panels.push(c),
    registerSettings: (c) => void rig.settingsSections.push(c),
    registerGridMenuItem: (c) => void rig.menuItems.push(c),
    registerSlot: (c) => void rig.slots.push(c),
    develop: {
      registerInputProfiles: (r) => void rig.resolvers.push(r),
      invalidateInputProfiles: () => void rig.invalidations++,
    },
    catalog: {
      useActivePhoto,
      async setInputProfile(ids, token) {
        rig.assigned.push({ ids, token });
        photos = photos.map((p) => (ids.includes(p.id) ? { ...p, inputProfile: token ?? undefined } : p));
        emitPhotos();
      },
    },
    presets: { pickFile: async () => rig.nextFile },
    ui: {
      Select,
      Button,
      Field,
      Stack,
      Row,
      tokens: TOKENS,
      alertDialog: async ({ message }) => void rig.alerts.push(message),
      confirmDialog: async () => rig.confirmAnswer,
    },
  };

  rig.api = new Proxy(members, {
    get(target, key) {
      if (key in target) return target[key as keyof FakeMembers];
      throw new Error(`fake api: ${String(key)} isn't implemented`);
    },
  }) as unknown as SafelightAPI;
  return rig;
}
