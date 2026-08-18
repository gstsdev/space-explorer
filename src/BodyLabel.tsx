import type { RefObject } from "react";
import { Html } from "@react-three/drei";

function capitalize(id: string) {
  return id[0].toUpperCase() + id.slice(1);
}

// A screen-space label anchored to a body's live (moving) position, via its
// parent group — Html reprojects every frame automatically, so this needs no
// per-frame code of its own. Stays a fixed CSS pixel size regardless of
// distance, like the placeholders, so it's always readable.
export function BodyLabel({
  id,
  selected,
  htmlRef,
}: {
  id: string;
  selected: boolean;
  // Optional: Html forwards its ref straight to the underlying
  // HTMLDivElement (not a Three.js object), so a caller that needs to
  // toggle this label's visibility outside of showLabel/selected — see the
  // Moon's own use of this — can do it the same imperative, no-re-render
  // way every other per-frame visibility toggle in this file already does.
  htmlRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <Html ref={htmlRef} center style={{ pointerEvents: "none" }}>
      <div
        style={{
          transform: "translateY(16px)",
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fontWeight: selected ? 700 : 400,
          color: selected ? "#ffffff" : "rgba(255, 255, 255, 0.55)",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)",
          whiteSpace: "nowrap",
        }}
      >
        {capitalize(id)}
      </div>
    </Html>
  );
}
