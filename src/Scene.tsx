import { Suspense, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, useTexture } from "@react-three/drei";
import { AdditiveBlending, BufferAttribute, DoubleSide, Euler, MathUtils, Quaternion, RingGeometry, ShaderMaterial, SRGBColorSpace, Vector3, RepeatWrapping, ClampToEdgeWrapping } from "three";
import type { Group, Mesh, Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ANGULAR_THRESHOLD,
  GM_SUN_SCALED,
  KM_TO_UNITS,
  MIN_VIEW_MULTIPLIER,
  PLACEHOLDER_SIZE,
  PLANETS,
  SUN_DATA,
  SUN_RADIUS,
  VIEW_MULTIPLIER,
} from "./astronomy";
import type { PlanetRingData, PlanetTextures } from "./astronomy";
import { simulation } from "./simulation";
import { FRAME_PRIORITY } from "./framePriority";

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

const hoverCursor = {
  onPointerOver: () => (document.body.style.cursor = "pointer"),
  onPointerOut: () => (document.body.style.cursor = "auto"),
};

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
// The final negated x below corrects a handedness mismatch caught by
// noticing planets visibly orbited clockwise in the running app instead of
// the real counterclockwise-from-ecliptic-north: world X and Z, as used
// here, formed a left-handed pair with world Y (X×Z = -Y, not +Y), the
// opposite of the standard right-handed orbital-mechanics convention every
// real inclination/ascendingNode/argumentOfPeriapsis value above assumes.
// Negating Y or Z instead would equally fix the orbit's rotational sense,
// but only negating X leaves the inclination/latitude math (already
// verified against real data) undisturbed — confirmed by re-running that
// same verification with this fix in place and getting the same ~0.2°
// match, plus longitude now separately matching real data to ~0.1°
// (previously wildly inconsistent, up to 170°+, across different dates).
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
  return [-(x * cosO - y * sinO * cosI), y * sinI, x * sinO + y * cosO * cosI];
}

function capitalize(id: string) {
  return id[0].toUpperCase() + id.slice(1);
}

// A screen-space label anchored to a body's live (moving) position, via its
// parent group — Html reprojects every frame automatically, so this needs no
// per-frame code of its own. Stays a fixed CSS pixel size regardless of
// distance, like the placeholders, so it's always readable.
function BodyLabel({ id, selected }: { id: string; selected: boolean }) {
  return (
    <Html center style={{ pointerEvents: "none" }}>
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

type OnFocus = (target: Object3D, id: string) => void;

// Textured surface material — split out so its useTexture() suspends only
// this material, not the whole planet, while the maps load. MeshPhongMaterial
// (not MeshStandardMaterial, used everywhere else) specifically because its
// specular/shininess model is what specularMap textures — including the
// classic "grayscale ocean mask" Earth specular maps — are authored for.
//
// nightMap (city lights) needs logic no built-in material has: emissive only
// on the side facing away from the sun. Rather than write a lighting shader
// from scratch, this extends Phong's own compiled shader via onBeforeCompile
// — injecting a varying for the un-transformed (object-space) normal and a
// sunDirection uniform (also object-space, so it's correct regardless of
// this mesh's own spin — see Planet, where it's computed each frame from the
// same rotation this mesh already applies to itself, no camera/world-matrix
// timing to get wrong), then adding the night texture as emissive light
// wherever that surface point faces away from the sun.
function TexturedSurface({
  textures,
  sunDirection,
}: {
  textures: PlanetTextures;
  sunDirection: RefObject<Vector3>;
}) {
  const maps = useTexture(textures);
  const mapsRef = useRef(maps);
  // useTexture loads via a plain THREE.TextureLoader, which defaults every
  // texture's colorSpace to linear (NoColorSpace) — correct for normalMap
  // (direction data, not color), but wrong for the three photographic maps.
  // Left as linear, a "near-black" pixel in nightMap (which should decode to
  // close to zero) instead samples much brighter than authored, which is
  // exactly what showed up as a "bright blue" glow across Earth's dark side.
  useEffect(() => {
    mapsRef.current.map.colorSpace = SRGBColorSpace;
    mapsRef.current.map.needsUpdate = true;
    if (mapsRef.current.specularMap) {
      mapsRef.current.specularMap.colorSpace = SRGBColorSpace;
      mapsRef.current.specularMap.needsUpdate = true;
    }
    if (mapsRef.current.nightMap) {
      mapsRef.current.nightMap.colorSpace = SRGBColorSpace;
      mapsRef.current.nightMap.needsUpdate = true;
    }
  }, [maps]);

  const shaderUniforms = useRef<{ sunDirection: { value: Vector3 } } | null>(null);

  useFrame(() => {
    if (shaderUniforms.current) shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <meshPhongMaterial
      map={maps.map}
      normalMap={maps.normalMap}
      specularMap={maps.specularMap}
      specular="#333333"
      shininess={15}
      onBeforeCompile={(shader) => {
        if (!maps.nightMap) return;

        shader.uniforms.nightMap = { value: maps.nightMap };
        shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };
        shaderUniforms.current = shader.uniforms as unknown as { sunDirection: { value: Vector3 } };

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjectNormal;")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjectNormal = objectNormal;");

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vObjectNormal;\nuniform sampler2D nightMap;\nuniform vec3 sunDirection;",
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            float dayFactor = smoothstep(-0.15, 0.15, dot(normalize(vObjectNormal), normalize(sunDirection)));
            totalEmissiveRadiance += texture2D(nightMap, vMapUv).rgb * (1.0 - dayFactor);`,
          );
      }}
    />
  );
}
 
function PlanetRing({
  ring,
  axialTiltRadians,
  radius,
  sunDirection,
}: {
  ring: PlanetRingData;
  axialTiltRadians: number;
  radius: number;
  sunDirection: RefObject<Vector3>;
}) {
  const texture = useTexture(ring.texture);
  const textureRef = useRef(texture);
  const shaderUniforms = useRef<{ sunDirection: { value: Vector3 } } | null>(
    null,
  );
 
  const ringGeometry = useMemo(() => {
    const innerRadius = radius * ring.innerRadiusRatio;
    const outerRadius = radius * ring.outerRadiusRatio;
    const geometry = new RingGeometry(innerRadius, outerRadius, 256, 1);
    const position = geometry.getAttribute("position");
    const uv = new Float32Array(position.count * 2);
    const radiusRange = outerRadius - innerRadius;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const theta = Math.atan2(y, x);
      const r = Math.sqrt(x * x + y * y);
      // The ring texture is a vertical slice where width maps to radius and
      // height maps to circumference, so swap the UV axes from the standard
      // ring parameterization.
      uv[i * 2] = (r - innerRadius) / radiusRange;
      uv[i * 2 + 1] = (theta + Math.PI) / (2 * Math.PI);
    }

    geometry.setAttribute("uv", new BufferAttribute(uv, 2));
    return geometry;
  }, [radius, ring.innerRadiusRatio, ring.outerRadiusRatio]);

  useEffect(() => {
    if (texture) {
      textureRef.current = texture;
      textureRef.current.rotation = 0;
      textureRef.current.center.set(0.5, 0.5);
      textureRef.current.wrapS = ClampToEdgeWrapping;
      textureRef.current.wrapT = RepeatWrapping;
      textureRef.current.repeat.set(1, 1);
      textureRef.current.needsUpdate = true;
    }
  }, [texture]);

  useFrame(() => {
    if (shaderUniforms.current)
      shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <mesh geometry={ringGeometry} rotation={[Math.PI / 2 + axialTiltRadians, 0, 0]}>
      <meshPhongMaterial
        map={texture}
        transparent
        alphaTest={0.05}
        opacity={ring.opacity ?? 0.9}
        side={DoubleSide}
        depthWrite={false}
        shininess={5}
        specular="#222222"
        onBeforeCompile={(shader) => {
          shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };
          shader.uniforms.planetRadius = { value: radius };
          shaderUniforms.current = shader.uniforms as unknown as { sunDirection: { value: Vector3 } };

          // vRingLocalPosition carries each fragment's un-rotated local
          // position (same space RingGeometry's vertices are authored in,
          // and the same space sunDirection below is expressed in) through
          // to the fragment shader, for the ray-sphere shadow test below.
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vRingLocalPosition;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRingLocalPosition = position;");

          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vRingLocalPosition;\nuniform vec3 sunDirection;\nuniform float planetRadius;",
            )
            // A real ring isn't an opaque sheet — it's countless ice/dust
            // particles, so even lit edge-on (sun near the ring's own plane)
            // it stays faintly visible via forward-scattering. An idealized
            // Lambertian disc has no such thing: dot(normal, sunDir) → 0
            // exactly at that crossing, so standard Phong shading goes fully
            // black there, which reads as a rendering bug rather than the
            // physically-expected (if exaggerated) ring-plane-crossing dimming.
            // RingGeometry's un-rotated per-vertex normal is always (0,0,1),
            // and sunDirection is already in this mesh's own object space
            // (computed in Planet from the same fixed rotation this mesh
            // carries), so no vertex-shader work is needed here — just
            // compare against a constant.
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float ringNdotL = dot(vec3(0.0, 0.0, 1.0), normalize(sunDirection));
              float grazing = 1.0 - abs(ringNdotL);
              totalEmissiveRadiance += diffuseColor.rgb * grazing * 0.35;`,
            )
            // Real (analytic) ray-sphere shadow test: is the sun blocked by
            // the planet as seen from this point on the ring? Unlike a
            // normal-based light, this is a pure position/geometry test —
            // correct on both ring faces at once (the planet blocks light
            // for the whole umbra region, not just "whichever face happens
            // to point sunward"), and confined entirely to this material, so
            // it can never spill extra brightness onto the sphere the way a
            // real scene light would (Three.js has no per-object light
            // exclusion, which is why we're not using one for this anymore).
            //
            // Deliberately a hard edge, not softened: the sun's angular size
            // from Saturn (~9.5 AU) is only ~0.056°, so the real penumbra
            // works out to a fraction of a percent of Saturn's own radius —
            // imperceptible at this scale. A stylized blur here would be
            // less accurate than the sharp edge real photos actually show.
            .replace(
              "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;",
              `vec3 toSun = normalize(sunDirection);
              float b = dot(vRingLocalPosition, toSun);
              float c = dot(vRingLocalPosition, vRingLocalPosition) - planetRadius * planetRadius;
              float h = b * b - c;
              float inShadow = (h > 0.0 && (-b - sqrt(h)) > 0.0) ? 1.0 : 0.0;
              float ringShadowFactor = mix(1.0, 0.25, inShadow);

              vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance) * ringShadowFactor;`,
            );
        }}
      />
    </mesh>
  );
}

type PlanetProps = {
  id: string;
  color: string;
  radius: number; // true-scale radius, in scene units
  semiMajorAxis: number; // true-scale orbit size, in scene units
  eccentricity: number; // 0 = circle, closer to 1 = more stretched-out ellipse
  rotationPeriodDays?: number;
  axialTiltDegrees?: number;
  inclinationDegrees?: number;
  ascendingNodeDegrees?: number;
  meanAnomalyAtEpochDegrees?: number;
  rotationAtEpochDegrees?: number;
  argumentOfPeriapsisDegrees?: number;
  selected: boolean;
  textures?: PlanetTextures;
  ring?: PlanetRingData;
  showOrbit: boolean;
  showPlaceholder: boolean;
  onFocus: OnFocus;
};

function Planet({
  id,
  color,
  radius,
  semiMajorAxis,
  eccentricity,
  rotationPeriodDays = 1,
  axialTiltDegrees = 0,
  inclinationDegrees = 0,
  ascendingNodeDegrees = 0,
  meanAnomalyAtEpochDegrees = 0,
  rotationAtEpochDegrees = 0,
  argumentOfPeriapsisDegrees = 0,
  selected,
  textures,
  ring,
  showOrbit,
  showPlaceholder,
  onFocus,
}: PlanetProps) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  // A body's true size only reads as a sphere once you're close; from any
  // real distance it's an invisible speck. This flat circle stands in for
  // it — rescaled every frame to the camera's distance so it stays a
  // constant size on screen, like a marker on a map — until we're close
  // enough to see the real mesh, at which point we swap to that instead.
  const placeholder = useRef<Mesh>(null);
  // Direction to the sun in this mesh's own OBJECT space (not world/view
  // space) — used by TexturedSurface's night-lights shader. Object space
  // means it's correct regardless of camera timing, and it naturally
  // accounts for this mesh's own spin (the terminator sweeps across the
  // rotating surface, like a real day/night cycle) for free.
  const sunDirection = useRef(new Vector3(0, 0, 1));
  const inverseRotation = useRef(new Quaternion());
  const ringSunDirection = useRef(new Vector3(0, 0, 1));
  // Sun direction in group-local space (== world space, since group only
  // ever translates) — the un-rotated base that sunDirection/ringSunDirection
  // are each derived from below.
  const localSunDirection = useRef(new Vector3(0, 0, 1));
  const axialTiltRadians = (axialTiltDegrees * Math.PI) / 180;
  const inclinationRadians = (inclinationDegrees * Math.PI) / 180;
  const ascendingNodeRadians = (ascendingNodeDegrees * Math.PI) / 180;
  const meanAnomalyAtEpochRadians = (meanAnomalyAtEpochDegrees * Math.PI) / 180;
  const rotationAtEpochRadians = (rotationAtEpochDegrees * Math.PI) / 180;
  const argumentOfPeriapsisRadians = (argumentOfPeriapsisDegrees * Math.PI) / 180;
  const ringInverseRotation = useMemo(
    () => new Quaternion().setFromEuler(new Euler(Math.PI / 2 + axialTiltRadians, 0, 0)).invert(),
    [axialTiltRadians],
  );
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

  // Apply axial tilt once on mount/update without making the mesh a
  // controlled prop; mutating rotation in useFrame must not be clobbered by
  // React re-applying a JSX rotation prop each render.
  useEffect(() => {
    if (mesh.current) {
      mesh.current.rotation.x = axialTiltRadians;
    }
  }, [axialTiltRadians]);

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
      mesh.current.rotation.y =
        (Math.PI + (rotationAtEpochRadians + rotationRadiansPerSecond * simulation.time)) %
        (2 * Math.PI);

      // Rotating the local sun direction into this mesh's object space right
      // here (rather than in TexturedSurface's own frame) means it's always
      // computed from this exact rotation.y update, never a stale one.
      mesh.current.getWorldQuaternion(inverseRotation.current).invert();
      sunDirection.current.copy(localSunDirection.current).applyQuaternion(inverseRotation.current);

      ringSunDirection.current.copy(localSunDirection.current).applyQuaternion(ringInverseRotation);
    }
  }, FRAME_PRIORITY.updatePosition);

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
              <TexturedSurface textures={textures} sunDirection={sunDirection} />
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
            axialTiltRadians={axialTiltRadians}
            radius={radius}
            sunDirection={ringSunDirection}
          />
        ) : null}
        <BodyLabel id={id} selected={selected} />
      </group>
    </>
  );
}

// Apparent on-screen size of the glare, using the same "scale = distance ×
// factor" trick as the placeholders — this keeps it a constant size on
// screen regardless of viewing distance, like real lens/eye glare does.
const GLARE_SIZE = 0.25;

// A soft, screen-space-sized glow standing in for the sun's glare as seen
// from realistic (planet-scale) distances — real cameras and eyes see a
// bright point source with a halo much bigger than its actual angular disk.
// Fades out over the same distance range the LOD system already uses to
// swap the sun's real mesh in for its placeholder, so the flat glow never
// overlaps the literal sphere geometry once you're that close.
function SunGlare() {
  const mesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);
  const switchDistance = SUN_RADIUS / ANGULAR_THRESHOLD;
  const focusDistance = SUN_RADIUS * VIEW_MULTIPLIER;

  useFrame((state) => {
    if (!mesh.current || !material.current) return;

    const distance = state.camera.position.length(); // the sun is always at the origin
    mesh.current.scale.setScalar(distance * GLARE_SIZE);

    const t = MathUtils.clamp((distance - focusDistance) / (switchDistance - focusDistance), 0, 1);
    material.current.uniforms.opacity.value = t * t * (3 - 2 * t); // smoothstep
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <Billboard>
      <mesh ref={mesh}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={material}
          transparent
          depthWrite={false}
          depthTest={true}
          blending={AdditiveBlending}
          uniforms={{ opacity: { value: 1 } }}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec2 vUv;
            uniform float opacity;
            void main() {
              float d = length(vUv - 0.5) * 2.0;
              float glow = pow(clamp(1.0 - d, 0.0, 1.0), 3.0);
              gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * glow, glow * opacity);
            }
          `}
        />
      </mesh>
    </Billboard>
  );
}

function Sun({
  selected,
  showPlaceholder,
  onFocus,
}: {
  selected: boolean;
  showPlaceholder: boolean;
  onFocus: OnFocus;
}) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const placeholder = useRef<Mesh>(null);
  const selectionRing = useRef<Mesh>(null);
  const switchDistance = SUN_RADIUS / ANGULAR_THRESHOLD;

  useFrame((_, delta) => {
    // Sun's rotation should follow the simulation clock so its visible
    // rotation speed matches the playback/time-scale control.
    if (mesh.current) mesh.current.rotation.y += 0.05 * delta * simulation.speed;
  }, FRAME_PRIORITY.updatePosition);

  // Runs after CameraRig — see the matching comment in Planet.
  useFrame((state) => {
    if (!group.current) return;

    const distance = state.camera.position.distanceTo(group.current.position);
    // With placeholders off, always show the real (true-scale) mesh instead
    // of hiding the body past switchDistance — from realistic distances it's
    // sub-pixel anyway, so it naturally reads as a small point of light, the
    // same reason real planets look like stars to the naked eye.
    const showReal = distance < switchDistance || !showPlaceholder;
    if (mesh.current) mesh.current.visible = showReal;
    if (placeholder.current) {
      placeholder.current.visible = !showReal && showPlaceholder;
      placeholder.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    if (selectionRing.current) {
      selectionRing.current.visible = !showReal && showPlaceholder && selected;
      selectionRing.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
  }, FRAME_PRIORITY.updateVisibility);

  const handleFocus = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (group.current) onFocus(group.current, SUN_DATA.id);
  };

  return (
    <group
      ref={(el) => {
        group.current = el;
        if (el) {
          el.userData.focusDistance = SUN_RADIUS * VIEW_MULTIPLIER;
          el.userData.minViewDistance = SUN_RADIUS * MIN_VIEW_MULTIPLIER;
        }
      }}
    >
      {/* True inverse-square falloff (decay=2) makes brightness ratios scale
      with distance *squared* — Mercury-to-Neptune is a ~78x distance ratio,
      which becomes ~6,050x in brightness. No single intensity puts both
      ends in a visible range: raising it enough to light Jupiter/Saturn
      blows out Mercury/Venus/Earth. decay=1 (inverse-linear) compresses
      that ratio back down to the same ~78x as the distance itself, which
      intensity alone can then comfortably span. */}
      <pointLight intensity={3000} decay={1} color="#fff4e0" />
      <SunGlare />
      <mesh ref={mesh} onClick={handleFocus} {...hoverCursor}>
        <sphereGeometry args={[SUN_RADIUS, 100, 100]} />
        <meshBasicMaterial color="#ffcc66" />
      </mesh>
      <Billboard>
        <mesh ref={placeholder} onClick={handleFocus} {...hoverCursor}>
          <circleGeometry args={[1, 24]} />
          <meshBasicMaterial color="#ffcc66" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <mesh ref={selectionRing}>
          <ringGeometry args={[1.4, 1.7, 32]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.9} />
        </mesh>
      </Billboard>
      <BodyLabel id={SUN_DATA.id} selected={selected} />
    </group>
  );
}

export function Scene({
  selectedId,
  showOrbits,
  showPlaceholders,
  onFocus,
}: {
  selectedId: string | null;
  showOrbits: boolean;
  showPlaceholders: boolean;
  onFocus: OnFocus;
}) {
  return (
    <>
      <Sun selected={selectedId === SUN_DATA.id} showPlaceholder={showPlaceholders} onFocus={onFocus} />
      {PLANETS.map((planet) => (
        <Planet
          key={planet.id}
          id={planet.id}
          color={planet.color}
          radius={planet.radiusKm * KM_TO_UNITS}
          semiMajorAxis={planet.semiMajorAxisKm * KM_TO_UNITS}
          eccentricity={planet.eccentricity}
          rotationPeriodDays={planet.rotationPeriodDays}
          axialTiltDegrees={planet.axialTiltDegrees}
          inclinationDegrees={planet.inclinationDegrees}
          ascendingNodeDegrees={planet.ascendingNodeDegrees}
          meanAnomalyAtEpochDegrees={planet.meanAnomalyAtEpochDegrees}
          rotationAtEpochDegrees={planet.rotationAtEpochDegrees}
          argumentOfPeriapsisDegrees={planet.argumentOfPeriapsisDegrees}
          selected={selectedId === planet.id}
          textures={planet.textures}
          ring={planet.ring}
          showOrbit={showOrbits}
          showPlaceholder={showPlaceholders}
          onFocus={onFocus}
        />
      ))}
    </>
  );
}
