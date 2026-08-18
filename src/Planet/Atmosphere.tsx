import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector3 } from "three";
import type { Mesh } from "three";
import { ATMOSPHERE_HEIGHT_EXAGGERATION } from "../astronomy";
import type { PlanetAtmosphereData } from "../astronomy";
import { FRAME_PRIORITY } from "../framePriority";
import { ATMOSPHERE_TERMINATOR_FADE_DOT, atmosphereIntensity } from "../atmosphereShading";

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
export function Atmosphere({
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
  const mesh = useRef<Mesh>(null);
  const outerRadius = radius * (1 + (atmosphere.scaleHeightKm * ATMOSPHERE_HEIGHT_EXAGGERATION) / radiusKm);
  const intensity = atmosphereIntensity(atmosphere.relativeSurfacePressure);
  const glowColor = useMemo(() => new Color(atmosphere.color), [atmosphere.color]);
  // Optional (see PlanetAtmosphereData's comment) — when a planet doesn't
  // have its own tuned night color, this component skips the tinting below
  // entirely rather than guessing a default, so it just fades glowColor's
  // own brightness as before.
  const nightColor = useMemo(
    () => (atmosphere.nightColor ? new Color(atmosphere.nightColor) : null),
    [atmosphere.nightColor],
  );
  const hasTint = Boolean(nightColor);

  useFrame(() => {
    if (!material.current) return;
    material.current.uniforms.sunDirection.value.copy(sunDirection.current);
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

  // With a tuned night color (see PlanetAtmosphereData): same day/night
  // split as untintedGlsl below, just landing on nightColor instead of a
  // darkened glowColor. No separate twilight color/band — an earlier
  // version of this shell shifted through a twilight tint in the 80-92°
  // range, but that tint rides the same `rim` term as the day/night split
  // itself, and near the poles of the visible limb (where the true
  // silhouette and the terminator meet at a shallow angle) the twilight
  // band's screen-space footprint stretches out along the limb — showing up
  // as a bright, saturated smear bulging past the terminator specifically
  // at the top/bottom of the disc. Simpler day-color/night-color-only
  // mixing avoids that failure mode entirely. (A sunset/twilight tint is
  // now handled instead as a surface-level term in TexturedSurface, keyed
  // purely on local sun elevation with no view-dependent rim gating — see
  // that component's own comment for why that sidesteps this artifact.)
  const tintedGlsl = `
    float daylight = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(vNormal, normalize(sunDirection)));
    vec3 finalColor = mix(nightColor, glowColor, daylight);
    float sunFactor = mix(0.3, 1.0, daylight);
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
    <mesh ref={mesh}>
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
          ...(hasTint ? { nightColor: { value: nightColor } } : {}),
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
          ${hasTint ? "uniform vec3 nightColor;" : ""}
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
