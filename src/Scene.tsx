import { Suspense, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, useTexture } from "@react-three/drei";
import { AdditiveBlending, BackSide, BufferAttribute, Color, DoubleSide, Euler, MathUtils, Quaternion, RingGeometry, ShaderMaterial, SRGBColorSpace, Vector3, RepeatWrapping, ClampToEdgeWrapping } from "three";
import type { Group, Mesh, Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ANGULAR_THRESHOLD,
  ATMOSPHERE_HEIGHT_EXAGGERATION,
  ATMOSPHERE_MAX_INTENSITY,
  ATMOSPHERE_MIN_INTENSITY,
  GM_SUN_SCALED,
  KM_TO_UNITS,
  MIN_VIEW_MULTIPLIER,
  PLACEHOLDER_SIZE,
  PLANETS,
  SUN_DATA,
  SUN_RADIUS,
  VIEW_MULTIPLIER,
} from "./astronomy";
import type { PlanetAtmosphereData, PlanetRingData, PlanetTextures } from "./astronomy";
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

// Shared by the atmosphere shell (Atmosphere) and the surface rim glow
// (TexturedSurface) so both derive "how strong does this planet's glow
// read" from the same real relativeSurfacePressure value — see
// PlanetAtmosphereData.relativeSurfacePressure's comment for why sqrt+clamp
// rather than the raw ratio.
function atmosphereIntensity(relativeSurfacePressure: number): number {
  return MathUtils.clamp(Math.sqrt(relativeSurfacePressure), ATMOSPHERE_MIN_INTENSITY, ATMOSPHERE_MAX_INTENSITY);
}

// Shared day/night law for both atmosphere rim shaders (Atmosphere's shell
// and TexturedSurface's surface reinforcement): fully lit whenever the sun
// is above the local horizon (angle between the light ray and the surface
// normal <= 90°, i.e. dot(N, sunDir) >= 0), reaching its night-side state by
// 5° past that. A sharp cutoff right at the horizon, not a broad
// half-lambert — replaces this file's earlier, separate day/night
// treatments for the two rim terms. TexturedSurface's night-side state is
// fully transparent (see untintedGlsl in Atmosphere for the shell's own,
// non-transparent night state when it has no tuned nightColor).
const ATMOSPHERE_TERMINATOR_FADE_DOT = Math.cos((95 * Math.PI) / 180); // dot(N, sunDir) at 5° past the terminator, ≈ -0.0872

// The Atmosphere shell's tinted color transitions only (see tintedGlsl in
// Atmosphere) — real gradients, not hairline anti-aliasing edges.
// Day -> twilight: a wide, gentle 10° fade from the planet's own atmosphere
// color into its twilightColor.
const ATMOSPHERE_TWILIGHT_START_DOT = Math.cos((80 * Math.PI) / 180); // dot(N, sunDir) at 80°, ≈ 0.1736
const ATMOSPHERE_TWILIGHT_END_DOT = Math.cos((90.25 * Math.PI) / 180); // dot(N, sunDir) at 90°, ≈ 0.0
// Twilight -> night: a narrower 3° fade, so the solid-twilightColor plateau
// between this and ATMOSPHERE_TWILIGHT_END_DOT above stays short (2°, 90°-92°)
// rather than the wide gap a symmetric ±width around ATMOSPHERE_TERMINATOR_FADE_DOT
// used to leave.
const ATMOSPHERE_NIGHT_START_DOT = Math.cos((90.75 * Math.PI) / 180); // dot(N, sunDir) at 92°, ≈ -0.0349

// Atmosphere's untinted branch only (no PlanetAtmosphereData.nightColor —
// see untintedGlsl): rather than fading to transparent on the night side,
// the glow settles at this fraction of the planet's own atmosphere color,
// full brightness (alpha) throughout — so it still reads as "the same
// atmosphere, dimmer," not a fade to nothing.
// 0-1 range: 0 fades the night side to a black (but still opaque) rim; 1
// removes the day/night difference entirely (full color all the way
// around); values above ~0.5 start reading as barely any dimming at all.
const ATMOSPHERE_UNTINTED_NIGHT_DARKEN = 0.2;


// The Atmosphere shell only. The shell is only ever visible in the thin
// annulus where it isn't occluded by the opaque ground beneath it (see the
// shell's own doc comment) — within that annulus, the raw Fresnel term
// increases monotonically from "close to the ground" up to 1.0 exactly at
// the shell's own outer edge (the true tangent silhouette, right at the
// border with empty space). Fading brightness *up* with that raw value
// therefore reads as glowing toward space and fading out into the ground —
// backwards from real reference photos (bright, saturated blue right where
// the atmosphere touches the visible ground/clouds, fading smoothly outward
// into black). This constant instead measures distance *from* that outer
// edge (0 = the true silhouette, growing toward the ground) and ramps
// brightness up over that small range, so the glow is brightest hugging the
// ground and fades to nothing right at the true edge — anchored to the
// shell's own geometric edge rather than a fixed threshold, so it holds up
// at any camera distance without separate tuning.
const ATMOSPHERE_RIM_FADE_WIDTH = 0.15;

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
//
// atmosphere (optional) adds a second, independent effect through the same
// onBeforeCompile patch: a radial gradient across the whole visible
// hemisphere, coupling the external Atmosphere shell's glow down onto the
// surface it's wrapping (real limb brightening lights the edge of the
// daylit ground itself, not just the air above it) — transparent at the
// point facing the camera dead-on, easing toward the atmosphere color at
// the grazing silhouette, always recentering on the camera since it's
// computed from the live view direction every frame. Unlike the day/night
// split above, this needs that view-dependent grazing angle, so it reuses
// Phong's own built-in vNormal/vViewPosition varyings (already view-space,
// already correct for this mesh's live rotation via the standard
// normalMatrix/modelViewMatrix three.js recomputes every frame) rather than
// the object-space vObjectNormal/sunDirection pair above — no camera matrix
// exists in that object-space pair to project a view angle through.
//
// Deliberately subtle (see atmosphereIntensity) — the shell already carries
// the limb glow on its own, so this is a soft reinforcement where the two
// overlap toward the edge, not a second full-strength copy of it.
const SURFACE_GLOW_FACTOR = 0.15;

// Shapes the radial gradient above: the raw Fresnel term (1 - |dot(N,V)|)
// is 0 at the point facing the camera and 1 at the true silhouette,
// already exactly the gradient wanted, so this just weights it toward the
// edge (rather than a linear ramp visible across the whole disk) — higher
// pulls the visible color closer to the edge, 1.0 would make it fully linear.
const ATMOSPHERE_SURFACE_GRADIENT_EXPONENT = 2;

// This term's own night floor — deliberately much lower than the Atmosphere
// shell's ATMOSPHERE_UNTINTED_NIGHT_DARKEN, not shared with it. The shell
// floats over black space either way, day or night, so darkening it instead
// of fading it out reads as "the same object, dimmer." This term is painted
// on the ground itself, which on the night side is otherwise essentially
// black (no direct light there) — so even a 20%-strength glow (the shell's
// floor) stands out starkly against that black backdrop, reading as
// *stronger* than the day side despite being dimmer in absolute terms. A
// much lower floor keeps it barely-there instead of a false highlight.
const ATMOSPHERE_SURFACE_NIGHT_DARKEN = 0.05;

function TexturedSurface({
  textures,
  sunDirection,
  atmosphere,
}: {
  textures: PlanetTextures;
  sunDirection: RefObject<Vector3>;
  atmosphere?: PlanetAtmosphereData;
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
        if (!maps.nightMap && !atmosphere) return;

        shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };
        shaderUniforms.current = shader.uniforms as unknown as { sunDirection: { value: Vector3 } };

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjectNormal;")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjectNormal = objectNormal;");

        let uniformDeclarations = "#include <common>\nvarying vec3 vObjectNormal;\nuniform vec3 sunDirection;";
        let emissiveAdditions = "#include <emissivemap_fragment>";

        if (maps.nightMap) {
          shader.uniforms.nightMap = { value: maps.nightMap };
          uniformDeclarations += "\nuniform sampler2D nightMap;";
          emissiveAdditions += `
            float dayFactor = smoothstep(-0.15, 0.15, dot(normalize(vObjectNormal), normalize(sunDirection)));
            totalEmissiveRadiance += texture2D(nightMap, vMapUv).rgb * (1.0 - dayFactor);`;
        }

        if (atmosphere) {
          shader.uniforms.atmosphereColor = { value: new Color(atmosphere.color) };
          shader.uniforms.atmosphereIntensity = {
            value: atmosphereIntensity(atmosphere.relativeSurfacePressure) * SURFACE_GLOW_FACTOR,
          };
          uniformDeclarations += "\nuniform vec3 atmosphereColor;\nuniform float atmosphereIntensity;";
          // vNormal/vViewPosition are Phong's own built-in varyings (declared
          // by normal_pars_fragment/lights_phong_pars_fragment, already in
          // scope by this point in the template) — see this component's own
          // doc comment for why the rim term uses these instead of the
          // object-space pair above.
          emissiveAdditions += `
            // Radial gradient across the whole visible hemisphere: 0 (fully
            // transparent) at the point facing the camera dead-on, easing
            // toward 1 (full atmosphereColor) at the grazing silhouette —
            // see ATMOSPHERE_SURFACE_GRADIENT_EXPONENT and this component's
            // own doc comment.
            float atmosphereRimBase = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
            float atmosphereRim = pow(atmosphereRimBase, ${ATMOSPHERE_SURFACE_GRADIENT_EXPONENT}.0);
            // Darkens toward night rather than fading out (same shape as
            // the Atmosphere shell's day/night law), but with its own,
            // much lower floor — see ATMOSPHERE_SURFACE_NIGHT_DARKEN for
            // why this can't just reuse the shell's.
            float atmosphereDaylight = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(normalize(vObjectNormal), normalize(sunDirection)));
            vec3 atmosphereFinalColor = mix(atmosphereColor * ${ATMOSPHERE_SURFACE_NIGHT_DARKEN}, atmosphereColor, atmosphereDaylight);
            totalEmissiveRadiance += atmosphereFinalColor * atmosphereRim * atmosphereIntensity;`;
        }

        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", uniformDeclarations)
          .replace("#include <emissivemap_fragment>", emissiveAdditions);
      }}
    />
  );
}
 
function PlanetRing({
  ring,
  ringQuaternion,
  radius,
  sunDirection,
}: {
  ring: PlanetRingData;
  ringQuaternion: Quaternion;
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
    <mesh geometry={ringGeometry} quaternion={ringQuaternion}>
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

// A thin glowing shell just outside the planet's real surface, standing in
// for atmospheric limb glow — real Rayleigh/aerosol scattering would need a
// raymarched volumetric shader, so this is a stylized Fresnel rim glow
// instead: brightest at the silhouette edge (grazing view angle) and on the
// sunlit side, dim on the night side, same as real limb photos show at a
// glance. BackSide + additive blending is the standard trick for this: front
// faces are culled so the shell never occludes the planet mesh underneath,
// while the far (inside) faces we do render still carry the same
// grazing-angle Fresnel term at the visible silhouette.
//
// The vertex shader treats object space as world space for both the normal
// and the sun-direction dot product below — valid here because this mesh has
// no rotation of its own and its parent group only ever translates (see
// localSunDirection's comment on Planet), so object-space directions already
// equal world-space ones.
function Atmosphere({
  atmosphere,
  radius,
  radiusKm,
  sunDirection,
}: {
  atmosphere: PlanetAtmosphereData;
  radius: number;
  radiusKm: number;
  sunDirection: RefObject<Vector3>;
}) {
  const material = useRef<ShaderMaterial>(null);
  const outerRadius = radius * (1 + (atmosphere.scaleHeightKm * ATMOSPHERE_HEIGHT_EXAGGERATION) / radiusKm);
  const intensity = atmosphereIntensity(atmosphere.relativeSurfacePressure);
  const glowColor = useMemo(() => new Color(atmosphere.color), [atmosphere.color]);
  // Both optional (see PlanetAtmosphereData's comment) — when a planet
  // doesn't have its own tuned twilight/night color, this component skips
  // the tinting below entirely rather than guessing a default, so it just
  // fades glowColor's own brightness as before.
  const twilightColor = useMemo(
    () => (atmosphere.twilightColor ? new Color(atmosphere.twilightColor) : null),
    [atmosphere.twilightColor],
  );
  const nightColor = useMemo(
    () => (atmosphere.nightColor ? new Color(atmosphere.nightColor) : null),
    [atmosphere.nightColor],
  );
  const hasTint = Boolean(twilightColor && nightColor);

  useFrame(() => {
    if (material.current) material.current.uniforms.sunDirection.value.copy(sunDirection.current);
  }, FRAME_PRIORITY.updateVisibility);

  // Shared by both branches below: rim is the distance from the shell's own
  // true silhouette (0 there, growing toward the ground) — see
  // ATMOSPHERE_RIM_FADE_WIDTH's comment for why this, and not the raw
  // Fresnel term, is what brightness ramps against: this way the glow is
  // brightest hugging the ground and fades out into space, not the reverse.
  const rimGlsl = `
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float rimBase = 1.0 - abs(dot(vNormal, viewDir));
    float edgeFade = 1.0 - rimBase;
    float rim = smoothstep(0.0, ${ATMOSPHERE_RIM_FADE_WIDTH}, edgeFade);
  `;

  // With a tuned twilight/night color (see PlanetAtmosphereData), the shell
  // shifts hue across three bands instead of just fading to black: the
  // planet's own atmosphere color, easing (smoothstep's own cubic
  // ease-in/ease-out) into its twilightColor over the wide 80-90° band
  // (ATMOSPHERE_TWILIGHT_START_DOT/END_DOT), holding that color over a
  // short 90-92° plateau, then easing into its nightColor (with a dimmed,
  // not zeroed, brightness) over the 92-95° band (ATMOSPHERE_NIGHT_START_DOT
  // to ATMOSPHERE_TERMINATOR_FADE_DOT).
  const tintedGlsl = `
    float dayDot = dot(vNormal, normalize(sunDirection));
    float towardTwilight = 1.0 - smoothstep(${ATMOSPHERE_TWILIGHT_END_DOT}, ${ATMOSPHERE_TWILIGHT_START_DOT}, dayDot);
    vec3 dayOrTwilightColor = mix(glowColor, twilightColor, towardTwilight);
    float towardNight = 1.0 - smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, ${ATMOSPHERE_NIGHT_START_DOT}, dayDot);
    vec3 finalColor = mix(dayOrTwilightColor, nightColor, towardNight);
    float sunFactor = mix(1.0, 0.3, towardNight);
    float glow = rim * sunFactor * intensity;
    gl_FragColor = vec4(finalColor, glow);
  `;

  // Without a tuned color (see PlanetAtmosphereData): the planet's own
  // atmosphere color, easing down to ATMOSPHERE_UNTINTED_NIGHT_DARKEN of
  // itself by 5° past the local horizon rather than fading to transparent
  // — see ATMOSPHERE_TERMINATOR_FADE_DOT. Alpha stays at full strength
  // throughout; only the color darkens, so the shell reads as "the same
  // atmosphere, dimmer at night," not a fade to nothing.
  const untintedGlsl = `
    float daylight = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(vNormal, normalize(sunDirection)));
    vec3 finalColor = mix(glowColor * ${ATMOSPHERE_UNTINTED_NIGHT_DARKEN}, glowColor, daylight);
    float glow = rim * intensity;
    gl_FragColor = vec4(finalColor, glow);
  `;

  return (
    <mesh>
      <sphereGeometry args={[outerRadius, 100, 100]} />
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        side={BackSide}
        blending={AdditiveBlending}
        uniforms={{
          sunDirection: { value: new Vector3(0, 0, 1) },
          glowColor: { value: glowColor },
          ...(hasTint ? { twilightColor: { value: twilightColor }, nightColor: { value: nightColor } } : {}),
          intensity: { value: intensity },
        }}
        vertexShader={`
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vNormal = normalize(normal);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          uniform vec3 sunDirection;
          uniform vec3 glowColor;
          ${hasTint ? "uniform vec3 twilightColor;\nuniform vec3 nightColor;" : ""}
          uniform float intensity;
          void main() {
            ${rimGlsl}
            ${hasTint ? tintedGlsl : untintedGlsl}
          }
        `}
      />
    </mesh>
  );
}

type PlanetProps = {
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
  ring?: PlanetRingData;
  atmosphere?: PlanetAtmosphereData;
  showOrbit: boolean;
  showPlaceholder: boolean;
  onFocus: OnFocus;
};

function Planet({
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
  ring,
  atmosphere,
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
  // Fresh spin-only quaternion, recomputed and combined with tiltQuaternion
  // every frame below — kept as a ref so that doesn't allocate per frame.
  const spinQuaternion = useRef(new Quaternion());
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
              <TexturedSurface textures={textures} sunDirection={sunDirection} atmosphere={atmosphere} />
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
          showOrbit={showOrbits}
          showPlaceholder={showPlaceholders}
          onFocus={onFocus}
        />
      ))}
    </>
  );
}
