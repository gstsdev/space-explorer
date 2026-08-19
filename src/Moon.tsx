import { Suspense, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import { Quaternion, Vector3 } from "three";
import type { Group, Mesh } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Line2, LineSegments2 } from "three-stdlib";
import {
  ANGULAR_THRESHOLD,
  KM_TO_UNITS,
  MIN_VIEW_MULTIPLIER,
  moonGeocentricEclipticPosition,
  MOON_MEAN_DISTANCE_KM,
  MOON_RELIEF_KM,
  MOON_SIDEREAL_MONTH_DAYS,
  PLACEHOLDER_SIZE,
  VIEW_MULTIPLIER,
} from "./astronomy";
import type { MoonData } from "./astronomy";
import { simulation } from "./simulation";
import { FRAME_PRIORITY } from "./framePriority";
import { BodyLabel } from "./BodyLabel";
import { hoverCursor } from "./sceneCommon";
import type { OnFocus } from "./sceneCommon";
import { MoonSurface } from "./Moon/MoonSurface";

// Converts a real ecliptic-frame position (longitude/latitude/distance —
// e.g. moonGeocentricEclipticPosition's own output) directly into this
// scene's world frame. Same ecliptic-to-world axis remap Planet's own
// polePositionWorld already established for *directions* (ecliptic
// (x,y,z=north) → world (x,z,-y), a pure rotation) — reused here for a
// *position* instead, which transforms the same way under a pure rotation.
// Cross-checked against Planet's own tiltOrbitalPosition convention: in the
// degenerate flat-orbit case (inclination/ascendingNode/argumentOfPeriapsis
// all 0), tiltOrbitalPosition reduces to world (xOrb, 0, -yOrb); this
// function's own β=0 case reduces to world (r cosλ, 0, -r sinλ) — the same
// (xOrb, 0, -yOrb) shape with r/λ standing in for the orbital-plane
// radius/angle, confirming both agree on what world +X/+Z mean.
function eclipticPositionWorld(
  longitudeDegrees: number,
  latitudeDegrees: number,
  distance: number,
): [number, number, number] {
  const longitude = (longitudeDegrees * Math.PI) / 180;
  const latitude = (latitudeDegrees * Math.PI) / 180;
  const cosLatitude = Math.cos(latitude);
  return [
    distance * cosLatitude * Math.cos(longitude),
    distance * Math.sin(latitude),
    -distance * cosLatitude * Math.sin(longitude),
  ];
}

const MOON_ORBIT_LINE_SEGMENTS = 512;

// Samples one sidereal month of the Moon's real (perturbed) path starting
// from daysSinceEpoch, for the orbit line — shared by the Moon component's
// initial mount-time render and its periodic re-sample (see
// MOON_ORBIT_LINE_REFRESH_SECONDS) so both build the exact same shape.
function sampleMoonOrbitPoints(daysSinceEpoch: number): [number, number, number][] {
  return Array.from({ length: MOON_ORBIT_LINE_SEGMENTS + 1 }, (_, i) => {
    const sampleDaysSinceEpoch = daysSinceEpoch + (i / MOON_ORBIT_LINE_SEGMENTS) * MOON_SIDEREAL_MONTH_DAYS;
    const { longitudeDegrees, latitudeDegrees, distanceKm } = moonGeocentricEclipticPosition(sampleDaysSinceEpoch);
    return eclipticPositionWorld(longitudeDegrees, latitudeDegrees, distanceKm * KM_TO_UNITS);
  });
}

// The Moon's tidal-lock reference axis (see the Moon component) — the local
// axis its texture's prime meridian lands on at zero rotation, same
// convention as every Planet's own spin (see Planet's spinAngle comment).
const LOCAL_X_AXIS = new Vector3(1, 0, 0);

// See the Moon's own visibility useFrame for why this exists: each
// placeholder has a fixed angular radius of PLACEHOLDER_SIZE (radians), so
// two placeholders visually clear each other once their angular separation
// exceeds roughly the sum of their radii — this adds some margin for the
// larger selection ring around a selected body.
const MOON_PLACEHOLDER_MIN_SEPARATION = 3 * PLACEHOLDER_SIZE;

// How often (real seconds, not simulated time) the Moon's orbit line
// re-samples and rebuilds its geometry — see the Moon component's own
// orbitPoints comment for why a one-time snapshot isn't enough. Real-time
// rather than simulated-time-based specifically so the refresh rate doesn't
// scale with the speed slider (at high playback speeds a simulated-time
// threshold would fire every single frame); this bounds the recompute cost
// the same way regardless of speed, and a few seconds of staleness at even
// the fastest playback speed still reads as "current" to the eye.
const MOON_ORBIT_LINE_REFRESH_SECONDS = 2;

// Deliberately not a generalized "orbiting body" component — see
// astronomy.ts's own comment on why this is scoped to Earth's Moon
// specifically. Structurally similar to Planet (same Kepler solver, same
// tiltOrbitalPosition, same LOD/label/selection boilerplate) but with two
// real differences: its position is Earth-relative (a literal Three.js
// child of Earth's own <group> — see Planet's own children prop) rather
// than sun-relative), and its orientation is real tidal lock (derived each
// frame from its own current orbital geometry) rather than an independent
// spin driven by rotationPeriodDays/poleRaDegrees/poleDecDegrees like every
// Planet.
export function Moon({
  moon,
  selected,
  showOrbit,
  showPlaceholder,
  showLabel,
  onFocus,
  exposeWorldPosition,
  earthRadiusKm,
}: {
  moon: MoonData;
  selected: boolean;
  showOrbit: boolean;
  showPlaceholder: boolean;
  showLabel: boolean;
  onFocus: OnFocus;
  // A Scene-level shared ref this writes its own live world position into
  // every frame, so Earth's own TexturedSurface can read it for its
  // eclipseShadow (a real solar-eclipse shadow cast by the Moon) — see
  // FRAME_PRIORITY.updateShadowCasters and PlanetProps.moonShadowCaster's
  // own comments for why this can't just be read directly the way this
  // component reads Earth's own position (via its literal Three.js parent).
  exposeWorldPosition: RefObject<Vector3>;
  earthRadiusKm: number;
}) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const placeholder = useRef<Mesh>(null);
  const selectionRing = useRef<Mesh>(null);
  const orbitLine = useRef<Line2 | LineSegments2>(null);
  const spinQuaternion = useRef(new Quaternion());
  // The label is a drei <Html> DOM overlay rather than a Three.js object, so
  // there's no .visible to flip — but Html forwards its ref straight to the
  // underlying HTMLDivElement (see BodyLabel's own htmlRef), so this can
  // still be toggled the same imperative, no-re-render way as the
  // placeholder/orbit line above, via style.display (the same property
  // Html's own internal behind-camera check already uses).
  const label = useRef<HTMLDivElement>(null);
  const towardEarthScratch = useRef(new Vector3());
  // Scratch for the LOD distance check below — group.current.position is
  // this mesh's position *relative to Earth's group* (its literal Three.js
  // parent), not world space, so unlike Planet's own equivalent check this
  // needs the real (parent-composed) world position instead. Also the
  // source this writes into exposeWorldPosition from (see the new useFrame
  // below), and reused for MoonSurface's own eclipseShadow.
  const worldPositionScratch = useRef(new Vector3());
  // This mesh's own inverse rotation and object-space sun direction — same
  // roles as Planet's own inverseRotation/sunDirection, added here (unlike
  // the rest of this component, which otherwise doesn't need object-space
  // shading) only because MoonSurface's eclipseShadow needs them.
  const inverseRotation = useRef(new Quaternion());
  const sunDirection = useRef(new Vector3(0, 0, 1));
  // Earth's live position in this mesh's own object space, for
  // MoonSurface's eclipseShadow (Earth's shadow on the Moon during a lunar
  // eclipse) — see the updateVisibility useFrame below.
  const earthPositionObjectSpace = useRef(new Vector3());

  const radius = moon.radiusKm * KM_TO_UNITS;
  const switchDistance = radius / ANGULAR_THRESHOLD;
  const displacementScale = MOON_RELIEF_KM * KM_TO_UNITS;

  // Initial orbit trace for the line's first paint, sampled one sidereal
  // month forward from whatever moment this component mounts — kept fresh
  // after that by the periodic re-sample below rather than left as a
  // one-time snapshot (see that useFrame's own comment for why: unlike a
  // planet's fixed ellipse, the Moon's real path — per
  // moonGeocentricEclipticPosition's own periodic terms — visibly changes
  // shape over the same timescale this app's speed slider can blow through
  // in seconds). Earth-relative, like the Moon's own position — rendered as
  // Earth's child too (below), so it rides along automatically.
  const orbitPoints = useMemo(() => sampleMoonOrbitPoints(simulation.time / 86_400), []);
  // Real seconds (not simulated time — see MOON_ORBIT_LINE_REFRESH_SECONDS)
  // since the orbit line's geometry was last rebuilt below.
  const orbitLineRefreshElapsed = useRef(0);

  // Rebuilds the orbit line's geometry in place every
  // MOON_ORBIT_LINE_REFRESH_SECONDS of real time, so it keeps tracking the
  // Moon's actual (perturbed, continuously-changing-shape) path instead of
  // drifting away from it — orbitPoints above is only ever this component's
  // *first* paint. Mutates the ref's geometry directly (setPositions, same
  // call drei's own <Line> makes internally when its points prop changes)
  // rather than through React state/props: this needs to run periodically
  // without forcing a re-render, the same reasoning behind every other
  // .current mutation in this file.
  useFrame((_, delta) => {
    orbitLineRefreshElapsed.current += delta;
    if (orbitLineRefreshElapsed.current < MOON_ORBIT_LINE_REFRESH_SECONDS) return;
    orbitLineRefreshElapsed.current = 0;
    if (!orbitLine.current) return;
    const points = sampleMoonOrbitPoints(simulation.time / 86_400);
    orbitLine.current.geometry.setPositions(points.flat());
  });

  useFrame(() => {
    if (!group.current) return;

    const daysSinceEpoch = simulation.time / 86_400;
    const { longitudeDegrees, latitudeDegrees, distanceKm } = moonGeocentricEclipticPosition(daysSinceEpoch);
    const [ox, oy, oz] = eclipticPositionWorld(longitudeDegrees, latitudeDegrees, distanceKm * KM_TO_UNITS);
    // Earth-relative, and this *is* the final position: Earth's own group
    // (this mesh's literal Three.js parent — see Planet's children prop)
    // only ever translates, so Three's own transform composition adds
    // Earth's position on top of this for free, correctly, regardless of
    // frame-to-frame update ordering between Earth and the Moon.
    group.current.position.set(ox, oy, oz);

    if (mesh.current) {
      // Real tidal lock: the same face always points at Earth, rather than
      // spinning at an independent rate the way every Planet does — so the
      // spin angle here comes from this frame's own orbital geometry (the
      // direction back to Earth, i.e. -position in this group-local/
      // Earth-relative space) instead of simulation.time directly. Only
      // rotates about a fixed world +Y spin axis (assumes the Moon's real
      // ~1.54° axial tilt is negligible, and ignores real optical
      // libration) — see astronomy.ts's own MoonData comment.
      towardEarthScratch.current.set(-ox, 0, -oz).normalize();
      spinQuaternion.current.setFromUnitVectors(LOCAL_X_AXIS, towardEarthScratch.current);
      mesh.current.quaternion.copy(spinQuaternion.current);
      inverseRotation.current.copy(mesh.current.quaternion).invert();
    }
  }, FRAME_PRIORITY.updatePosition);

  // Writes this frame's live world position for Earth's own TexturedSurface
  // to read (see exposeWorldPosition's own doc comment) — must run after
  // every body's own updatePosition (so getWorldPosition walks up to
  // Earth's *this-frame* position, not last frame's) and before anything
  // downstream reads it, hence its own dedicated priority.
  useFrame(() => {
    if (!group.current) return;
    group.current.getWorldPosition(worldPositionScratch.current);
    exposeWorldPosition.current.copy(worldPositionScratch.current);
  }, FRAME_PRIORITY.updateShadowCasters);

  useFrame((state) => {
    if (!group.current) return;
    // worldPositionScratch is already fresh for this frame — written above
    // at FRAME_PRIORITY.updateShadowCasters, strictly before this stage.
    const distance = state.camera.position.distanceTo(worldPositionScratch.current);
    const closeEnough = distance < switchDistance;
    const showReal = closeEnough || !showPlaceholder;

    if (group.current.parent) {
      // Sun direction from the Moon ≈ sun direction from Earth — negligible
      // parallax at 1 AU vs ~384,000 km, same approximation TexturedSurface's
      // own eclipseShadow relies on for the reverse case. group.current.parent
      // is Earth's own <group> (see Planet's children prop), whose .position
      // is already world-space and, being set at Planet's own updatePosition
      // (-20), guaranteed fresh here (0) regardless of same-tier ordering.
      sunDirection.current
        .copy(group.current.parent.position)
        .multiplyScalar(-1)
        .normalize()
        .applyQuaternion(inverseRotation.current);
      // Earth's position relative to the Moon, in the Moon's own object
      // space — MoonSurface's eclipseShadow (Earth's shadow on the Moon
      // during a lunar eclipse).
      earthPositionObjectSpace.current
        .copy(group.current.parent.position)
        .sub(worldPositionScratch.current)
        .applyQuaternion(inverseRotation.current);
    }

    // The real Earth-Moon separation (~384,000 km) is tiny next to
    // interplanetary camera distances, so from far enough out the Moon's
    // own placeholder — fixed angular size, like every placeholder, since
    // its world scale tracks distance-to-camera exactly (see
    // PLACEHOLDER_SIZE) — ends up sitting on top of Earth's own, blocking
    // clicks on Earth. group.current.parent is Earth's own <group> (Moon is
    // rendered as its literal child — see Planet's children prop), and its
    // .position is already world-space, same assumption Planet's own code
    // relies on throughout. Once the angular separation between Earth and
    // the Moon (as seen from the camera) drops below roughly their combined
    // on-screen size, hide the Moon's placeholder entirely rather than let
    // it compete with Earth's for clicks — a UI/UX threshold, not a real
    // astronomical one (unlike ANGULAR_THRESHOLD).
    const parentDistance = group.current.parent
      ? state.camera.position.distanceTo(group.current.parent.position)
      : distance;
    const currentlySeparated =
      (MOON_MEAN_DISTANCE_KM * KM_TO_UNITS) / parentDistance > MOON_PLACEHOLDER_MIN_SEPARATION;

    if (mesh.current) mesh.current.visible = showReal;
    if (placeholder.current) {
      placeholder.current.visible = !closeEnough && showPlaceholder && currentlySeparated;
      placeholder.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    if (selectionRing.current) {
      selectionRing.current.visible = !closeEnough && showPlaceholder && selected && currentlySeparated;
      selectionRing.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    // Same reasoning as the placeholder above: the orbit ellipse itself is
    // only ~384,000 km across, so from far enough out it's a meaningless
    // smudge right on top of Earth rather than a readable path — and same
    // for the label (see the label ref's own comment for why this is a
    // style.display write instead of a .visible one).
    if (orbitLine.current) orbitLine.current.visible = currentlySeparated;
    if (label.current) label.current.style.display = currentlySeparated ? "" : "none";
  }, FRAME_PRIORITY.updateVisibility);

  const handleFocus = (event: ThreeEvent<MouseEvent>) => {
    // See Planet's own handleFocus for why this check exists: .visible
    // doesn't stop raycasting, so this mesh/placeholder stays clickable even
    // while hidden (e.g. by the separatedFromEarth check above) unless this
    // bails out and lets the click fall through to Earth instead.
    if (!event.eventObject.visible) return;
    event.stopPropagation();
    if (group.current) onFocus(group.current, moon.id);
  };

  return (
    <>
      {showOrbit && (
        <Line
          ref={orbitLine}
          points={orbitPoints}
          color={moon.color}
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
          <Suspense fallback={<meshStandardMaterial color={moon.color} roughness={0.9} metalness={0} />}>
            <MoonSurface
              textures={moon.textures}
              tint={moon.surfaceTint}
              displacementScale={displacementScale}
              displacementBias={-displacementScale / 2}
              sunDirection={sunDirection}
              eclipseShadow={{ casterPositionObjectSpace: earthPositionObjectSpace, casterRadiusKm: earthRadiusKm }}
            />
          </Suspense>
        </mesh>
        <Billboard>
          <mesh ref={placeholder} onClick={handleFocus} {...hoverCursor}>
            <circleGeometry args={[1, 24]} />
            <meshBasicMaterial color={moon.color} depthTest={false} transparent opacity={0.85} />
          </mesh>
          <mesh ref={selectionRing}>
            <ringGeometry args={[1.4, 1.7, 32]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.9} />
          </mesh>
        </Billboard>
        {showLabel ? <BodyLabel id={moon.id} selected={selected} htmlRef={label} /> : null}
      </group>
    </>
  );
}
