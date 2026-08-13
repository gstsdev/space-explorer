import type { CSSProperties, ReactNode } from "react";
import { Orbit, CircleDot, Sparkles, Camera } from "lucide-react";

const buttonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
};

function ToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{
        ...buttonBaseStyle,
        background: active ? "rgba(255, 255, 255, 0.15)" : "transparent",
        color: active ? "#ffffff" : "rgba(255, 255, 255, 0.4)",
      }}
    >
      {children}
    </button>
  );
}

export function ViewControls({
  showOrbits,
  onToggleOrbits,
  showPlaceholders,
  onTogglePlaceholders,
  showStars,
  onToggleStars,
  onEnterPictureMode,
}: {
  showOrbits: boolean;
  onToggleOrbits: () => void;
  showPlaceholders: boolean;
  onTogglePlaceholders: () => void;
  showStars: boolean;
  onToggleStars: () => void;
  onEnterPictureMode: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 10,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(6px)",
      }}
    >
      <ToggleButton active={showOrbits} label="Toggle orbit lines" onClick={onToggleOrbits}>
        <Orbit size={18} strokeWidth={2} />
      </ToggleButton>
      <ToggleButton active={showPlaceholders} label="Toggle planet indicators" onClick={onTogglePlaceholders}>
        <CircleDot size={18} strokeWidth={2} />
      </ToggleButton>
      <ToggleButton active={showStars} label="Toggle stars/Milky Way" onClick={onToggleStars}>
        <Sparkles size={18} strokeWidth={2} />
      </ToggleButton>
      <ToggleButton active label="Picture mode (Esc to exit)" onClick={onEnterPictureMode}>
        <Camera size={18} strokeWidth={2} />
      </ToggleButton>
    </div>
  );
}
