// "Assign input profile…" from the Library's right-click menu: a dialogue
// over the app to give every targeted photo the same profile. It is mounted
// through an empty Library toolbar slot, since a menu item only gets ids.

import type { Controller } from "./controller";
import { profileGroups } from "./menu";
import { useController } from "./Panel";
import { React, api } from "./rt";
import { EMBEDDED } from "./tokens";

type Listener = (ids: string[] | null) => void;

let target: string[] | null = null;
const listeners = new Set<Listener>();

export function openAssignDialog(ids: string[]): void {
  target = ids.length ? ids : null;
  for (const listener of listeners) listener(target);
}

export function closeAssignDialog(): void {
  openAssignDialog([]);
}

function useTarget(): string[] | null {
  const [ids, setIds] = React.useState(target);
  React.useEffect(() => {
    listeners.add(setIds);
    return () => void listeners.delete(setIds);
  }, []);
  return ids;
}

export function AssignDialog({ controller }: { controller: Controller }) {
  useController(controller);
  const ids = useTarget();
  const [value, setValue] = React.useState(EMBEDDED);
  const { Select, Button, Row, Stack, tokens } = api.ui;

  React.useEffect(() => {
    if (!ids) return;
    setValue(EMBEDDED);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAssignDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids]);

  if (!ids) return null;
  const count = ids.length === 1 ? "1 photo" : `${ids.length} photos`;

  async function apply() {
    if (!ids) return;
    await controller.assign(ids, value);
    closeAssignDialog();
  }

  return api.reactDom.createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && closeAssignDialog()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assign input profile"
        style={{
          width: 320,
          padding: 16,
          borderRadius: 8,
          background: tokens.surface2,
          border: `1px solid ${tokens.border}`,
          color: tokens.textPrimary,
        }}
      >
        <Stack gap={12}>
          <div style={{ fontWeight: 600 }}>Input profile for {count}</div>
          <Select
            value={value}
            groups={profileGroups(controller.entries(), "Embedded profile", value)}
            ariaLabel="Input profile"
            onChange={setValue}
          />
          <Row gap={8} justify="flex-end">
            <Button variant="ghost" onClick={closeAssignDialog}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void apply()}>
              Assign
            </Button>
          </Row>
        </Stack>
      </div>
    </div>,
    document.body,
  );
}
