import type { CSSProperties } from "react";
import { KM_PER_AU, orbitalPeriodDays, PLANETS, SUN_DATA } from "./astronomy";

function capitalize(id: string) {
  return id[0].toUpperCase() + id.slice(1);
}

function formatPeriod(days: number) {
  if (days < 1000) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(1)} years`;
}

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span style={{ color: "rgba(255, 255, 255, 0.6)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function StatsPanel({ selectedId }: { selectedId: string | null }) {
  const isSun = selectedId === SUN_DATA.id;
  const planet = isSun ? undefined : PLANETS.find((p) => p.id === selectedId);
  const body = isSun ? SUN_DATA : planet;
  if (!body) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 200,
        padding: "12px 16px",
        borderRadius: 10,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(6px)",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        userSelect: "none",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700 }}>{capitalize(body.id)}</div>
      <Stat label="Radius" value={`${Math.round(body.radiusKm).toLocaleString()} km`} />
      {planet && (
        <>
          <Stat
            label="Distance from Sun"
            value={`${(planet.semiMajorAxisKm / KM_PER_AU).toFixed(2)} AU`}
          />
          <Stat label="Eccentricity" value={planet.eccentricity.toFixed(4)} />
          <Stat label="Orbital period" value={formatPeriod(orbitalPeriodDays(planet.semiMajorAxisKm))} />
        </>
      )}
      {!planet && <Stat label="Type" value="Star" />}
    </div>
  );
}
