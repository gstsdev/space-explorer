import { useState } from "react";
import { Info } from "lucide-react";
import {
  EARTH_MOON_DATA,
  KM_PER_AU,
  MOON_MEAN_DISTANCE_KM,
  MOON_MEAN_ECCENTRICITY,
  MOON_SIDEREAL_MONTH_DAYS,
  orbitalPeriodDays,
  PLANETS,
  SUN_DATA,
} from "../astronomy";
import styles from "./StatsPanel.module.css";

function capitalize(id: string) {
  return id[0].toUpperCase() + id.slice(1);
}

function formatPeriod(days: number) {
  if (days < 1000) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(1)} years`;
}

function formatAxialTilt(degrees?: number) {
  if (degrees === undefined) return "—";
  return `${degrees.toFixed(2)}°`;
}

function formatRotationDirectionFromTilt(degrees?: number) {
  if (degrees === undefined) return "—";
  // If the tilt is greater than 90° (or less than -90°) the north pole is
  // flipped and the apparent rotation from an external viewpoint is
  // retrograde.
  const absDeg = Math.abs(degrees);
  return absDeg > 90 ? "Retrograde" : "Prograde";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function StatsPanel({ selectedId }: { selectedId: string | null }) {
  // Mobile-only: the panel starts hidden behind this toggle so it doesn't
  // eat screen space by default on narrow viewports; irrelevant above the
  // 580px breakpoint, where the toggle button is itself hidden by CSS and
  // the panel is always shown.
  const [open, setOpen] = useState(false);
  const isSun = selectedId === SUN_DATA.id;
  const isMoon = selectedId === EARTH_MOON_DATA.id;
  const planet =
    isSun || isMoon ? undefined : PLANETS.find((p) => p.id === selectedId);
  const body = isSun ? SUN_DATA : isMoon ? EARTH_MOON_DATA : planet;
  if (!body) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Hide stats panel" : "Show stats panel"}
        aria-pressed={open}
        title={open ? "Hide stats panel" : "Show stats panel"}
        data-active={open}
        className={styles.toggleButton}
      >
        <Info size={18} strokeWidth={2} />
      </button>
      <div className={styles.panel} data-open={open}>
        <div className={styles.title}>{capitalize(body.id)}</div>
        <Stat
          label="Radius"
          value={`${Math.round(body.radiusKm).toLocaleString()} km`}
        />
        {planet && (
          <>
            <Stat
              label="Distance from Sun"
              value={`${(planet.semiMajorAxisKm / KM_PER_AU).toFixed(2)} AU`}
            />
            <Stat label="Eccentricity" value={planet.eccentricity.toFixed(4)} />
            <Stat
              label="Orbital period"
              value={formatPeriod(orbitalPeriodDays(planet.semiMajorAxisKm))}
            />
            <Stat
              label="Rotation period"
              value={formatPeriod(planet.rotationPeriodDays)}
            />
            <Stat
              label="Rotation direction"
              value={formatRotationDirectionFromTilt(planet.axialTiltDegrees)}
            />
            <Stat
              label="Axial tilt"
              value={formatAxialTilt(planet.axialTiltDegrees)}
            />
          </>
        )}
        {isMoon && (
          <>
            <Stat
              label="Distance from Earth"
              value={`${Math.round(MOON_MEAN_DISTANCE_KM).toLocaleString()} km`}
            />
            <Stat
              label="Eccentricity"
              value={MOON_MEAN_ECCENTRICITY.toFixed(4)}
            />
            <Stat
              label="Orbital period"
              value={formatPeriod(MOON_SIDEREAL_MONTH_DAYS)}
            />
            <Stat label="Rotation" value="Tidally locked" />
          </>
        )}
        {isSun && <Stat label="Type" value="Star" />}
      </div>
    </>
  );
}
