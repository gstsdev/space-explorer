import { Suspense, useEffect, useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import { Euler, Quaternion, Vector3 } from "three";
import type { Group, Mesh } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ANGULAR_THRESHOLD,
  GM_SUN_SCALED,
  MIN_VIEW_MULTIPLIER,
  PLACEHOLDER_SIZE,
  VIEW_MULTIPLIER,
} from "./astronomy";
import type { PlanetAtmosphereData, PlanetCloudsData, PlanetRingData, PlanetTextures } from "./astronomy";
import { simulation } from "./simulation";
import { FRAME_PRIORITY } from "./framePriority";
import { BodyLabel } from "./BodyLabel";
import { hoverCursor } from "./sceneCommon";
import type { OnFocus } from "./sceneCommon";
import { sunOcclusionBodies } from "./sunProperties";
import type { OcclusionBody } from "./sunProperties";
import { Atmosphere } from "./Planet/Atmosphere";
import { Clouds } from "./Planet/Clouds";
import { PlanetRing } from "./Planet/PlanetRing";
import { TexturedSurface } from "./Planet/TexturedSurface";

// Kepler's equation (M = E - e·sinE) has no closed-form solution for E, so we
// approximate it with Newton-Raphson. Mean anomaly M advances at a constant
// rate (it's just "fraction of the orbit's time elapsed"), but the planet's
// actual angular position, the eccentric anomaly E, doesn't advance at a
// constant rate on an ellipse — this solve is what turns "elapsed time" into
// "where the planet actually is right now."
function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number) {
  let E = meanAnomaly;
  for (let i = 0; i < 5; i++) {
    E -= (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
  }
  return E;
}

// Rotates a point in the flat 2D orbital plane (xOrb, yOrb — yOrb being the
// in-plane axis perpendicular to xOrb, i.e. what used to go straight into
// world Z) into tilted 3D world space: inclination is how far the plane
// tilts, ascendingNode is which direction (around the vertical axis) it
// tilts toward. At inclination 0 this reduces to (xOrb, 0, yOrb) — the flat,
// single-plane orbit every planet used before inclination existed.
//
// argumentOfPeriapsis runs first, entirely within the flat plane, before any
// of that: xOrb/yOrb (from eccentric anomaly) place perihelion at in-plane
// angle 0 by construction, but real perihelion doesn't generally sit at the
// ascending node — it's real angular distance away, measured in the
// direction of motion. Without this rotation, every planet's orbit was
// implicitly (and wrongly) assumed to have perihelion exactly at its
// ascending node — for Earth specifically, this is also what fixes the
// seasons: rotation.y's fixed tilt axis is only edge-on to the sun (an
// equinox) when Earth's position lines up with world +X, so where world +X
// actually falls in the orbit (relative to perihelion) directly decides
// when the seasons happen. Verified against real JPL data across a full
// year of dates (latitude/season match held within ~0.2° throughout) —
// see PlanetData.argumentOfPeriapsisDegrees.
//
// The final negated z below corrects a handedness mismatch caught by
// noticing planets visibly orbited clockwise in the running app instead of
// the real counterclockwise-from-ecliptic-north: world X and Z, as used
// here, formed a left-handed pair with world Y (X×Z = -Y, not +Y), the
// opposite of the standard right-handed orbital-mechanics convention every
// real inclination/ascendingNode/argumentOfPeriapsis value above assumes.
// (An earlier version of this fix negated x instead — it happened to satisfy
// every check available at the time, including Earth's real latitude/season
// match, but that was a coincidence of Earth's own inclination being exactly
// 0; checking Mars's actual 3D position — not just its orbital elements —
// against real JPL data caught that it was wrong in general. This version is
// cross-checked against both Mars and Earth's real heliocentric position
// (~0.03-0.05° accuracy) and, together with polePositionWorld below,
// Earth's real sub-solar longitude and latitude (~0.2°).)
function tiltOrbitalPosition(
  xOrb: number,
  yOrb: number,
  argumentOfPeriapsis: number,
  inclination: number,
  ascendingNode: number,
): [number, number, number] {
  const cosW = Math.cos(argumentOfPeriapsis);
  const sinW = Math.sin(argumentOfPeriapsis);
  const x = xOrb * cosW - yOrb * sinW;
  const y = xOrb * sinW + yOrb * cosW;

  const cosO = Math.cos(ascendingNode);
  const sinO = Math.sin(ascendingNode);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  return [x * cosO - y * sinO * cosI, y * sinI, -(x * sinO + y * cosO * cosI)];
}

// Mean obliquity of the ecliptic at J2000.0 — Earth's equatorial plane
// relative to the ecliptic. Needed below to convert a planet's real pole
// orientation (published by IAU/IAG as right ascension/declination in the
// equatorial/ICRF frame) into this scene's ecliptic-based world frame.
const OBLIQUITY_RADIANS = (23.4392911 * Math.PI) / 180;

// A planet's real axial-tilt *orientation* (not just magnitude), from its
// real north pole right ascension/declination (PlanetData.poleRaDegrees/
// poleDecDegrees — the IAU/IAG rotational-elements convention) rather than
// a single fixed-axis tilt angle. A single angle can only describe a
// rotation about one fixed axis, which is only physically correct for
// Earth — every other planet has a nonzero real ascendingNodeDegrees (its
// orbital plane is rotated relative to Earth's), so "tilt about world +X"
// silently assumed an equinox direction that isn't real for that planet,
// which is why only Earth's sub-solar point ever matched real data.
//
// Two steps: 1) the pole's RA/Dec gives its unit vector in the equatorial
// (ICRF) frame directly; 2) rotate that into ecliptic coordinates via the
// obliquity — a fixed rotation about the X axis, since X (the vernal
// equinox) is shared by both frames — then remap ecliptic (X, Y, Z=north)
// into this app's world frame (X, Y=up, Z). That remap is (x, y, z) →
// (x, z, -y): since Earth's own orbit defines world X as the vernal
// equinox and world Y as "up", world is just the ecliptic frame rotated
// -90° about the shared X axis — a pure rotation (not a mirroring), so it
// composes safely with tiltOrbitalPosition's own z-negation above.
//
// For Earth (RA=0, Dec=90) this reduces exactly to the old single-axis
// rotation about world X by -obliquity, so Earth's already-verified
// result is unaffected. For every other planet it was checked against
// real JPL Horizons sub-solar latitude and, unlike the old single-axis
// code, actually lands in the right hemisphere at the right magnitude
// (e.g. Uranus: was −61°, now ~+71° against a real +73°).
function polePositionWorld(poleRaDegrees: number, poleDecDegrees: number): Vector3 {
  const ra = (poleRaDegrees * Math.PI) / 180;
  const dec = (poleDecDegrees * Math.PI) / 180;
  const xEquatorial = Math.cos(dec) * Math.cos(ra);
  const yEquatorial = Math.cos(dec) * Math.sin(ra);
  const zEquatorial = Math.sin(dec);

  const cosObliquity = Math.cos(OBLIQUITY_RADIANS);
  const sinObliquity = Math.sin(OBLIQUITY_RADIANS);
  const yEcliptic = yEquatorial * cosObliquity + zEquatorial * sinObliquity;
  const zEcliptic = -yEquatorial * sinObliquity + zEquatorial * cosObliquity;

  return new Vector3(xEquatorial, zEcliptic, -yEcliptic);
}

const NORTH_POLE_AXIS = new Vector3(0, 1, 0);

export type PlanetProps = {
  id: string;
  color: string;
  radius: number; // true-scale radius, in scene units
  radiusKm: number;
  semiMajorAxis: number; // true-scale orbit size, in scene units
  eccentricity: number; // 0 = circle, closer to 1 = more stretched-out ellipse
  rotationPeriodDays?: number;
  poleRaDegrees?: number;
  poleDecDegrees?: number;
  inclinationDegrees?: number;
  ascendingNodeDegrees?: number;
  meanAnomalyAtEpochDegrees?: number;
  rotationAtEpochDegrees?: number;
  argumentOfPeriapsisDegrees?: number;
  selected: boolean;
  textures?: PlanetTextures;
  surfaceTint?: string;
  ring?: PlanetRingData;
  atmosphere?: PlanetAtmosphereData;
  clouds?: PlanetCloudsData;
  showOrbit: boolean;
  showPlaceholder: boolean;
  showLabel: boolean;
  onFocus: OnFocus;
  // A body in orbit around this planet (currently only ever the Moon,
  // around Earth) — rendered as a literal child of this planet's own
  // <group> below, so Three's own transform hierarchy carries it along for
  // free as this planet moves (that group only ever translates, same
  // invariant localSunDirection already relies on), with no manual
  // position-adding or frame-ordering dependency on this planet's own
  // per-frame update needed.
  children?: ReactNode;
  // Only ever set for Earth: the Moon's own live world position (written
  // every frame by the Moon component itself, at FRAME_PRIORITY.
  // updateShadowCasters — see that priority's own comment for why this
  // needs to be a Scene-level shared ref rather than something Planet can
  // read directly, the way the Moon reads Earth's position via its own
  // Three.js parent) plus its real radius, so this planet's own
  // TexturedSurface can cast a real eclipse shadow from it.
  moonShadowCaster?: { worldPosition: RefObject<Vector3>; radiusKm: number };
};

export function Planet({
  id,
  color,
  radius,
  radiusKm,
  semiMajorAxis,
  eccentricity,
  rotationPeriodDays = 1,
  poleRaDegrees = 0,
  poleDecDegrees = 90,
  inclinationDegrees = 0,
  ascendingNodeDegrees = 0,
  meanAnomalyAtEpochDegrees = 0,
  rotationAtEpochDegrees = 0,
  argumentOfPeriapsisDegrees = 0,
  selected,
  textures,
  surfaceTint,
  ring,
  atmosphere,
  clouds,
  showOrbit,
  showPlaceholder,
  showLabel,
  onFocus,
  children,
  moonShadowCaster,
}: PlanetProps) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  // A body's true size only reads as a sphere once you're close; from any
  // real distance it's an invisible speck. This flat circle stands in for
  // it — rescaled every frame to the camera's distance so it stays a
  // constant size on screen, like a marker on a map — until we're close
  // enough to see the real mesh, at which point we swap to that instead.
  const placeholder = useRef<Mesh>(null);
  // Atmosphere/Clouds are separate meshes, each real (if thin) 3D geometry
  // rather than a billboard placeholder — nothing else keeps them in sync
  // with the real surface mesh's own closeEnough/showReal LOD swap below,
  // so without these they'd stay visible at their true (tiny) real-scale
  // size even once the surface itself has swapped to the placeholder,
  // showing as a small but clearly-visible shell floating around what's
  // now just a flat dot.
  const atmosphereMesh = useRef<Mesh>(null);
  const cloudsMesh = useRef<Mesh>(null);
  // Direction to the sun in this mesh's own OBJECT space (not world/view
  // space) — used by TexturedSurface's night-lights shader. Object space
  // means it's correct regardless of camera timing, and it naturally
  // accounts for this mesh's own spin (the terminator sweeps across the
  // rotating surface, like a real day/night cycle) for free.
  const sunDirection = useRef(new Vector3(0, 0, 1));
  const inverseRotation = useRef(new Quaternion());
  // Only meaningful when moonShadowCaster is set (Earth): the Moon's live
  // position in this mesh's own object space, for TexturedSurface's
  // eclipseShadow — see the new useFrame below and moonShadowCaster's own
  // doc comment on PlanetProps.
  const moonPositionObjectSpace = useRef(new Vector3());
  const ringSunDirection = useRef(new Vector3(0, 0, 1));
  // Sun direction in group-local space (== world space, since group only
  // ever translates) — the un-rotated base that sunDirection/ringSunDirection
  // are each derived from below.
  const localSunDirection = useRef(new Vector3(0, 0, 1));
  // Fresh spin-only quaternion, recomputed and combined with tiltQuaternion
  // every frame below — kept as a ref so that doesn't allocate per frame.
  const spinQuaternion = useRef(new Quaternion());
  // This planet's slot in the shared sunOcclusionBodies registry (see its
  // own comment) — registered on mount, kept in sync every frame alongside
  // group.current.position below, removed on unmount.
  const occlusionBody = useRef<OcclusionBody>({
    position: new Vector3(),
    radius,
  });
  useEffect(() => {
    const body = occlusionBody.current;
    sunOcclusionBodies.push(body);
    return () => {
      const index = sunOcclusionBodies.indexOf(body);
      if (index !== -1) sunOcclusionBodies.splice(index, 1);
    };
  }, []);
  const inclinationRadians = (inclinationDegrees * Math.PI) / 180;
  const ascendingNodeRadians = (ascendingNodeDegrees * Math.PI) / 180;
  const meanAnomalyAtEpochRadians = (meanAnomalyAtEpochDegrees * Math.PI) / 180;
  const rotationAtEpochRadians = (rotationAtEpochDegrees * Math.PI) / 180;
  const argumentOfPeriapsisRadians = (argumentOfPeriapsisDegrees * Math.PI) / 180;
  // The rotation that takes this mesh's local spin axis (+Y) to this
  // planet's real pole direction in world space — see polePositionWorld.
  const tiltQuaternion = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        NORTH_POLE_AXIS,
        polePositionWorld(poleRaDegrees, poleDecDegrees),
      ),
    [poleRaDegrees, poleDecDegrees],
  );
  // The ring's own orientation: bring its flat XY-plane geometry into the
  // planet's equatorial plane (a fixed +90° about local X, same as the old
  // single-axis code) before applying the same real pole tilt as the mesh,
  // so the ring lies in the planet's real equatorial plane, not a fixed one.
  const ringQuaternion = useMemo(
    () => tiltQuaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))),
    [tiltQuaternion],
  );
  const ringInverseRotation = useMemo(() => ringQuaternion.clone().invert(), [ringQuaternion]);
  // Ring around the placeholder marking it as the current selection — kept
  // in lockstep with the placeholder's own scale in the same frame, below.
  const selectionRing = useRef<Mesh>(null);

  const period = 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / GM_SUN_SCALED);
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity ** 2);
  const rotationRadiansPerSecond =
    (2 * Math.PI) / (rotationPeriodDays * 24 * 60 * 60);
  // Distance at which the body's axial tilt crosses the "readable" threshold.
  const switchDistance = radius / ANGULAR_THRESHOLD;

  // Trace the same ellipse the planet moves along, so the orbit path is
  // visible even though it's a static line (not an actual fading trail).
  const orbitPoints = useMemo(() => {
    const segments = 1024;
    return Array.from({ length: segments + 1 }, (_, i) => {
      const E = (i / segments) * Math.PI * 2;
      return tiltOrbitalPosition(
        semiMajorAxis * (Math.cos(E) - eccentricity),
        semiMinorAxis * Math.sin(E),
        argumentOfPeriapsisRadians,
        inclinationRadians,
        ascendingNodeRadians,
      );
    });
  }, [
    semiMajorAxis,
    eccentricity,
    semiMinorAxis,
    argumentOfPeriapsisRadians,
    inclinationRadians,
    ascendingNodeRadians,
  ]);

  // Runs before CameraRig: advances this planet along its orbit for the
  // current frame using this frame's already-advanced simulation time (see
  // FRAME_PRIORITY — SimulationClock runs even earlier).
  useFrame(() => {
    if (!group.current) return;

    // Mean anomaly: where the planet would be if it moved at constant speed
    // around the orbit. meanAnomalyAtEpochRadians anchors it to the planet's
    // real position at J2000.0; simulation.time (seconds since that same
    // epoch) advances it from there, so simulation.time = secondsSinceJ2000()
    // (the clock's real-time seed) reproduces the planet's actual current
    // position, not an arbitrary start pose. Uses the shared simulation clock
    // (real seconds × playback speed), not the render clock, so the speed
    // slider affects every body in lockstep.
    const twoPi = 2 * Math.PI;
    const rawMeanAnomaly = meanAnomalyAtEpochRadians + (simulation.time / period) * twoPi;
    const meanAnomaly = ((rawMeanAnomaly % twoPi) + twoPi) % twoPi;
    const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, eccentricity);

    // Converting eccentric anomaly to a point on the ellipse. The sun sits at
    // the ellipse's focus, not its center, so the center is offset by a·e —
    // this is what makes the planet speed up near the sun (perihelion) and
    // slow down far from it (aphelion), per Kepler's second law, without us
    // ever simulating a force. tiltOrbitalPosition then rotates that flat
    // in-plane point into this orbit's actual (usually slightly tilted) 3D
    // plane, so the planet doesn't just move along the flat orbit line.
    group.current.position.set(
      ...tiltOrbitalPosition(
        semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
        semiMinorAxis * Math.sin(eccentricAnomaly),
        argumentOfPeriapsisRadians,
        inclinationRadians,
        ascendingNodeRadians,
      ),
    );

    // Sun is always at the origin, so world-space (== group-local, since
    // group only ever translates) direction to it is just -position.
    localSunDirection.current.set(0, 0, 0).sub(group.current.position).normalize();

    occlusionBody.current.position.copy(group.current.position);

    if (mesh.current) {
      // Computed directly from simulation.time (seconds since J2000.0), the
      // same way orbital position is above, rather than accumulated with +=
      // from a rotation.y of 0 at mount — accumulating from 0 ignored
      // however much simulation.time already had elapsed by the time this
      // component mounted, so the visible face never matched the real one at
      // "now". rotationAtEpochRadians anchors the real phase at that epoch.
      //
      // The extra Math.PI is a geometry correction, not an astronomy one,
      // and was pinned down empirically (checked against a real clock and
      // location) rather than fully re-derived here: per SphereGeometry's
      // own UV formula (x = -r·cos(u·2π)), this texture's prime meridian
      // (u=0.5 — confirmed by eye, Europe/Africa sit at the image's
      // horizontal center) lands on local +X at rotation.y=0, yet the real
      // sub-solar longitude still came out exactly half a turn off without
      // this term. Should carry over to every other planet's texture as-is,
      // independent of each one's own epoch constant.
      const spinAngle =
        (Math.PI + (rotationAtEpochRadians + rotationRadiansPerSecond * simulation.time)) %
        (2 * Math.PI);
      // Spin happens first, about the mesh's own local +Y (its pre-tilt
      // pole axis), then the whole thing is tilted to the real pole
      // direction — the same "spin, then tilt" composition the old
      // rotation.x/rotation.y Euler pair gave for free (Euler 'XYZ' applies
      // Y before X), generalized to a non-axis-aligned tilt via explicit
      // quaternion composition since tiltQuaternion isn't a pure X rotation
      // for most planets.
      spinQuaternion.current.setFromAxisAngle(NORTH_POLE_AXIS, spinAngle);
      mesh.current.quaternion.multiplyQuaternions(tiltQuaternion, spinQuaternion.current);

      // Rotating the local sun direction into this mesh's object space right
      // here (rather than in TexturedSurface's own frame) means it's always
      // computed from this exact spin update, never a stale one. mesh's
      // local quaternion doubles as its world quaternion since the parent
      // group only ever translates (see localSunDirection's comment above).
      inverseRotation.current.copy(mesh.current.quaternion).invert();
      sunDirection.current.copy(localSunDirection.current).applyQuaternion(inverseRotation.current);

      ringSunDirection.current.copy(localSunDirection.current).applyQuaternion(ringInverseRotation);
    }
  }, FRAME_PRIORITY.updatePosition);

  // Only meaningful when moonShadowCaster is set (Earth). Needs to run
  // strictly after FRAME_PRIORITY.updateShadowCasters, when the Moon
  // component has already written moonShadowCaster.worldPosition for this
  // frame (see that priority's own comment) — updateCamera works for this
  // (any priority between updateShadowCasters and updateVisibility would),
  // reused rather than adding a fourth micro-stage just for this one read.
  useFrame(() => {
    if (!moonShadowCaster || !group.current) return;
    moonPositionObjectSpace.current
      .copy(moonShadowCaster.worldPosition.current)
      .sub(group.current.position)
      .applyQuaternion(inverseRotation.current);
  }, FRAME_PRIORITY.updateCamera);

  // Runs after CameraRig: by now the camera has already caught up to this
  // frame's (fresh) planet position, so this distance check can't read a
  // stale camera position — see FRAME_PRIORITY for why that split matters.
  useFrame((state) => {
    if (!group.current) return;

    const distance = state.camera.position.distanceTo(group.current.position);
    const closeEnough = distance < switchDistance;
    // With placeholders off, keep the real mesh visible even past
    // switchDistance — same as the sun — instead of hiding it. From
    // realistic distances it's genuinely sub-pixel and invisible out there;
    // we tried standing in a glow for it, but even that was too small at
    // true scale to be worth the added complexity, so this is now an
    // honest (if often literally invisible) "this is where it really is."
    const showReal = closeEnough || !showPlaceholder;
    if (mesh.current) mesh.current.visible = showReal;
    if (atmosphereMesh.current) atmosphereMesh.current.visible = showReal;
    if (cloudsMesh.current) cloudsMesh.current.visible = showReal;
    if (placeholder.current) {
      placeholder.current.visible = !closeEnough && showPlaceholder;
      placeholder.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    if (selectionRing.current) {
      selectionRing.current.visible = !closeEnough && showPlaceholder && selected;
      selectionRing.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
  }, FRAME_PRIORITY.updateVisibility);

  const handleFocus = (event: ThreeEvent<MouseEvent>) => {
    // Three.js's own raycasting never checks .visible (only render layers
    // do — see intersect() in three's Raycaster.js), so an object hidden via
    // the LOD/visibility useFrame above is still fully clickable underneath
    // its own invisible geometry unless this checks explicitly. Bailing out
    // without stopPropagation (rather than swallowing the event) lets R3F's
    // own distance-ordered dispatch continue on to whatever's actually
    // visible at this screen position instead.
    if (!event.eventObject.visible) return;
    event.stopPropagation();
    if (group.current) onFocus(group.current, id);
  };

  return (
    <>
      {showOrbit && (
        <Line
          points={orbitPoints}
          color={color}
          transparent
          opacity={selected ? 0.9 : 0.3}
          linewidth={selected ? 2 : 1}
        />
      )}
      <group
        ref={(el) => {
          group.current = el;
          if (el) {
            el.userData.focusDistance = radius * VIEW_MULTIPLIER;
            el.userData.minViewDistance = radius * MIN_VIEW_MULTIPLIER;
          }
        }}
      >
        <mesh ref={mesh} onClick={handleFocus} {...hoverCursor}>
          <sphereGeometry args={[radius, 100, 100]} />
          {textures ? (
            <Suspense fallback={<meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />}>
              <TexturedSurface
                textures={textures}
                tint={surfaceTint}
                sunDirection={sunDirection}
                atmosphere={atmosphere}
                eclipseShadow={
                  moonShadowCaster
                    ? { casterPositionObjectSpace: moonPositionObjectSpace, casterRadiusKm: moonShadowCaster.radiusKm }
                    : undefined
                }
              />
            </Suspense>
          ) : (
            <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
          )}
        </mesh>
        <Billboard>
          <mesh ref={placeholder} onClick={handleFocus} {...hoverCursor}>
            <circleGeometry args={[1, 24]} />
            <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.85} />
          </mesh>
          <mesh ref={selectionRing}>
            <ringGeometry args={[1.4, 1.7, 32]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.9} />
          </mesh>
        </Billboard>
        {ring ? (
          <PlanetRing
            ring={ring}
            ringQuaternion={ringQuaternion}
            radius={radius}
            sunDirection={ringSunDirection}
          />
        ) : null}
        {atmosphere ? (
          <Atmosphere
            atmosphere={atmosphere}
            radius={radius}
            radiusKm={radiusKm}
            sunDirection={localSunDirection}
            meshRef={atmosphereMesh}
          />
        ) : null}
        {clouds ? (
          <Clouds clouds={clouds} radius={radius} sunDirection={localSunDirection} meshRef={cloudsMesh} />
        ) : null}
        {showLabel ? <BodyLabel id={id} selected={selected} /> : null}
        {children}
      </group>
    </>
  );
}
