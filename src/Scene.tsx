import { useRef } from "react";
import { Vector3 } from "three";
import { EARTH_MOON_DATA, KM_TO_UNITS, PLANETS, SUN_DATA } from "./astronomy";
import type { OnFocus } from "./sceneCommon";
import { Planet } from "./Planet";
import { Moon } from "./Moon";
import { Sun } from "./Sun";

export function Scene({
  selectedId,
  showOrbits,
  showPlaceholders,
  showLabels,
  onFocus,
}: {
  selectedId: string | null;
  showOrbits: boolean;
  showPlaceholders: boolean;
  showLabels: boolean;
  onFocus: OnFocus;
}) {
  // Shared with Earth's own Planet instance below (moonShadowCaster) so its
  // TexturedSurface can cast a real eclipse shadow from the Moon — see
  // PlanetProps.moonShadowCaster's own comment for why this needs to live
  // here rather than being read directly the way the Moon reads Earth's own
  // position.
  const moonWorldPosition = useRef(new Vector3());

  return (
    <>
      <Sun
        selected={selectedId === SUN_DATA.id}
        showPlaceholder={showPlaceholders}
        showLabel={showLabels}
        onFocus={onFocus}
      />
      {PLANETS.map((planet) => (
        <Planet
          key={planet.id}
          id={planet.id}
          color={planet.color}
          radius={planet.radiusKm * KM_TO_UNITS}
          radiusKm={planet.radiusKm}
          semiMajorAxis={planet.semiMajorAxisKm * KM_TO_UNITS}
          eccentricity={planet.eccentricity}
          rotationPeriodDays={planet.rotationPeriodDays}
          poleRaDegrees={planet.poleRaDegrees}
          poleDecDegrees={planet.poleDecDegrees}
          inclinationDegrees={planet.inclinationDegrees}
          ascendingNodeDegrees={planet.ascendingNodeDegrees}
          meanAnomalyAtEpochDegrees={planet.meanAnomalyAtEpochDegrees}
          rotationAtEpochDegrees={planet.rotationAtEpochDegrees}
          argumentOfPeriapsisDegrees={planet.argumentOfPeriapsisDegrees}
          selected={selectedId === planet.id}
          textures={planet.textures}
          ring={planet.ring}
          atmosphere={planet.atmosphere}
          clouds={planet.clouds}
          showOrbit={showOrbits}
          showPlaceholder={showPlaceholders}
          showLabel={showLabels}
          onFocus={onFocus}
          moonShadowCaster={
            planet.id === "earth"
              ? { worldPosition: moonWorldPosition, radiusKm: EARTH_MOON_DATA.radiusKm }
              : undefined
          }
        >
          {planet.id === "earth" ? (
            <Moon
              moon={EARTH_MOON_DATA}
              selected={selectedId === EARTH_MOON_DATA.id}
              showOrbit={showOrbits}
              showPlaceholder={showPlaceholders}
              showLabel={showLabels}
              onFocus={onFocus}
              exposeWorldPosition={moonWorldPosition}
              earthRadiusKm={planet.radiusKm}
            />
          ) : null}
        </Planet>
      ))}
    </>
  );
}
