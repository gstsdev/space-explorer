import type { ReactNode } from "react";
import { Orbit, CircleDot, Sparkles, Camera } from "lucide-react";
import type { QualityPreference } from "../quality";
import styles from "./ViewControls.module.css";

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
      data-active={active}
      className={styles.toggleButton}
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
      className={styles.qualitySegment}
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
            data-active={active}
            className={styles.qualityButton}
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
    <div className={styles.container}>
      <ToggleButton
        active={showOrbits}
        label="Toggle orbit lines"
        onClick={onToggleOrbits}
      >
        <Orbit size={18} strokeWidth={2} />
      </ToggleButton>
      <ToggleButton
        active={showPlaceholders}
        label="Toggle planet indicators"
        onClick={onTogglePlaceholders}
      >
        <CircleDot size={18} strokeWidth={2} />
      </ToggleButton>
      <ToggleButton
        active={showStars}
        label="Toggle stars/Milky Way"
        onClick={onToggleStars}
      >
        <Sparkles size={18} strokeWidth={2} />
      </ToggleButton>
      <QualitySegment
        value={qualityPreference}
        onChange={onChangeQualityPreference}
      />
      <ToggleButton
        active
        label="Picture mode (Esc to exit)"
        onClick={onEnterPictureMode}
      >
        <Camera size={18} strokeWidth={2} />
      </ToggleButton>
    </div>
  );
}
