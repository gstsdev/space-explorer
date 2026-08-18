import type { Object3D } from "three";

// Shared by every clickable body mesh (Planet, Moon, Sun, SunGlare) so
// hovering any of them shows the same "this is clickable" affordance.
export const hoverCursor = {
  onPointerOver: () => (document.body.style.cursor = "pointer"),
  onPointerOut: () => (document.body.style.cursor = "auto"),
};

export type OnFocus = (target: Object3D, id: string) => void;
