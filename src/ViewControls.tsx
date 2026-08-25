import type { CSSProperties, ReactNode } from "react";
import { Orbit, CircleDot, Sparkles, Camera } from "lucide-react";
import type { QualityPreference } from "./quality";

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

const QUALITY_OPTIONS: { preference: QualityPreference; label: string }[] = [
  { preference: "auto", label: "Auto" },
  { preference: "low", label: "Low" },
  { preference: "high", label: "High" },
];

// Render quality (Clouds shader detail + skybox resolution — see
// quality.ts). The only non-boolean control here, so it gets its own
// segmented row of text buttons rather than an icon toggle.
function QualitySegment({
  value,
  onChange,
}: {
  value: QualityPreference;
  onChange: (preference: QualityPreference) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Render quality"
      title="Render quality (Auto detects device capability)"
      style={{
        display: "flex",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {QUALITY_OPTIONS.map(({ preference, label }) => {
        const active = value === preference;
        return (
          <button
            key={preference}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(preference)}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "0 10px",
              height: 36,
              fontSize: 12,
              fontWeight: 600,
              background: active ? "rgba(255, 255, 255, 0.15)" : "transparent",
              color: active ? "#ffffff" : "rgba(255, 255, 255, 0.4)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ViewControls({
  showOrbits,
  onToggleOrbits,
  showPlaceholders,
  onTogglePlaceholders,
  showStars,
  onToggleStars,
  qualityPreference,
  onChangeQualityPreference,
  onEnterPictureMode,
}: {
  showOrbits: boolean;
  onToggleOrbits: () => void;
  showPlaceholders: boolean;
  onTogglePlaceholders: () => void;
  showStars: boolean;
  onToggleStars: () => void;
  qualityPreference: QualityPreference;
  onChangeQualityPreference: (preference: QualityPreference) => void;
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
      <QualitySegment value={qualityPreference} onChange={onChangeQualityPreference} />
      <ToggleButton active label="Picture mode (Esc to exit)" onClick={onEnterPictureMode}>
        <Camera size={18} strokeWidth={2} />
      </ToggleButton>
    </div>
  );
}
