import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color } from "three";
import type { ShaderMaterial } from "three";
import { GM_SUN_KM3_S2, KM_PER_AU, KM_TO_UNITS, MAIN_BELT_DATA } from "./astronomy";
import { simulation } from "./simulation";
import { FRAME_PRIORITY } from "./framePriority";

const AU_SCENE_UNITS = KM_PER_AU * KM_TO_UNITS;
// Kepler's third law, re-derived in AU rather than reusing astronomy.ts's
// GM_SUN_SCALED (scene-units³/s²) against raw scene-unit radii (~300-500
// for this belt): r³ at that scale is ~3e7-1.2e8 in the shader below, safe
// at highp but risking overflow on a spec-minimum mediump float (GLSL ES's
// guaranteed range is only ±2^14). Normalizing to AU first keeps r³ at
// ~9-36 instead, closing that off regardless of precision tier — hence
// `precision="highp"` below is defense-in-depth, not load-bearing.
const GM_SUN_AU3_S2 = GM_SUN_KM3_S2 / KM_PER_AU ** 3;

// A shaded flat disc can't actually produce round "grain"-like specks from
// every viewing angle: a speck baked into a zero-thickness plane's own
// local (noise-space) pattern has no real extent perpendicular to that
// plane, so at a grazing/near-edge-on view its screen-space footprint
// collapses toward a sliver no matter how the noise is tuned — stacking
// several such planes at different heights (an earlier version of this
// file did that) only adds more slivers, it doesn't fix any one of them.
// A real point cloud sidesteps this: each point rasterizes as a
// camera-facing sprite (GL_POINTS), so it reads as a round dot from any
// angle, the same reason star-field point clouds don't have this problem
// (see Skybox.tsx's own comment for why this app avoids drei's Stars
// specifically — a true-scale point *size* issue, unrelated to this).
const PARTICLE_COUNT = 9000;

// Eyeballed order-of-magnitude stand-in for the real belt's vertical
// scatter (see MAIN_BELT_DATA's own comment) — real inclinations range up
// to ~30°, but the bulk of the population sits much closer to the
// midplane, which the triangular (not uniform) height distribution below
// approximates.
const BELT_HALF_THICKNESS_AU = 0.3;

function buildBeltGeometry(): BufferGeometry {
  const innerAu = MAIN_BELT_DATA.innerRadiusKm / KM_PER_AU;
  const outerAu = MAIN_BELT_DATA.outerRadiusKm / KM_PER_AU;
  const innerAu2 = innerAu * innerAu;
  const outerAu2 = outerAu * outerAu;

  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const scales = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Uniform-*area* sampling across the annulus, not uniform-radius (which
    // would bunch particles up near the inner edge) — r = sqrt(lerp(inner²,
    // outer², u)) is the standard inverse-CDF for a uniform 2D annulus.
    const u = Math.random();
    const rAu = Math.sqrt(innerAu2 + u * (outerAu2 - innerAu2));
    const theta = Math.random() * Math.PI * 2;
    // Sum of two uniforms → a triangular distribution peaking at the
    // midplane and tapering to zero at ±BELT_HALF_THICKNESS_AU, a cheap
    // stand-in for the real population's concentration near the ecliptic
    // rather than a hard-edged uniform slab.
    const heightAu = (Math.random() + Math.random() - 1) * BELT_HALF_THICKNESS_AU;
    const rScene = rAu * AU_SCENE_UNITS;

    // Matches Planet.tsx's own tiltOrbitalPosition (x, -z)-from-angle
    // convention (see that function's comment) so this belt's rotation
    // below turns the same prograde direction as every planet, not an
    // arbitrarily-chosen opposite one.
    positions[i * 3] = rScene * Math.cos(theta);
    positions[i * 3 + 1] = heightAu * AU_SCENE_UNITS;
    positions[i * 3 + 2] = -rScene * Math.sin(theta);

    scales[i] = 0.6 + Math.random() * 1.0;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aScale", new BufferAttribute(scales, 1));
  return geometry;
}

const beltGeometry = buildBeltGeometry();
const beltColor = new Color(MAIN_BELT_DATA.color);

export function AsteroidBelt() {
  const material = useRef<ShaderMaterial>(null);

  useFrame(() => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = simulation.time;
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <points geometry={beltGeometry}>
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        precision="highp"
        uniforms={{
          uTime: { value: 0 },
          beltColor: { value: beltColor },
        }}
        vertexShader={`
          #include <common>
          #include <logdepthbuf_pars_vertex>
          uniform float uTime;
          attribute float aScale;
          varying float vScale;
          varying vec3 vSunDirView;
          void main() {
            // position is each particle's own fixed t=0 (x, height, z) —
            // computed once on the CPU in buildBeltGeometry, see that
            // function's own comment. Everything below just rotates the
            // (x, z) part around the real angular rate its own radius
            // implies, real per-particle motion rather than a shader
            // illusion applied to a static pattern.
            vec2 base = position.xz;
            float rAu = length(base) / ${AU_SCENE_UNITS.toFixed(6)};
            // Kepler's third law inverted to an angular rate at this
            // particle's own radius — same real law/constant every
            // planet's own orbital period already uses (astronomy.ts's
            // GM_SUN_KM3_S2) — so inner-belt particles genuinely orbit
            // faster than outer ones.
            float omega = sqrt(${GM_SUN_AU3_S2.toExponential(6)} / (rAu * rAu * rAu));
            // Wrapped for float32 safety — uTime (seconds since J2000) only
            // grows, and at 1e8s the fastest (inner-edge) particles have
            // completed close to one full real revolution, keeping the
            // wrap's own phase jump small.
            float wrappedTime = mod(uTime, 1.0e8);
            float delta = omega * wrappedTime;
            float cosD = cos(delta);
            float sinD = sin(delta);
            vec3 worldPosition = vec3(
              base.x * cosD + base.y * sinD,
              position.y,
              base.y * cosD - base.x * sinD
            );

            // The sun sits at the world origin (same convention every
            // planet's own localSunDirection uses — see Planet.tsx) so the
            // direction from this particle to the sun is just its own
            // position, negated. Rotated into view space (mat3(viewMatrix),
            // a direction so no translation) because gl_PointCoord's local
            // x/y in the fragment shader below are already aligned with the
            // screen/view plane's own right/up axes — see that shader's own
            // comment for how this becomes real per-grain lit/shadowed
            // shading instead of a flat, self-lit-looking dot.
            vSunDirView = normalize(mat3(viewMatrix) * normalize(-worldPosition));

            vec4 mvPosition = modelViewMatrix * vec4(worldPosition, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            // Fixed screen-space size, not distance-attenuated — like this
            // app's other placeholders, real asteroids are sub-pixel from
            // any realistic distance, so this is already a stylized "here's
            // where they are" marker rather than a literal-scale point.
            gl_PointSize = 2.4 * aScale;
            vScale = aScale;
            #include <logdepthbuf_vertex>
          }
        `}
        fragmentShader={`
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform vec3 beltColor;
          varying float vScale;
          varying vec3 vSunDirView;
          void main() {
            #include <logdepthbuf_fragment>
            // Standard point-sprite "sphere impostor" trick: gl_PointCoord's
            // local x/y already align with the screen/view plane's own
            // right/up axes, so (x, y, sqrt(1-x²-y²)) is a plausible unit
            // normal for the near hemisphere of a tiny sphere facing the
            // camera — cheap enough to fake real per-grain lighting without
            // any actual 3D geometry per particle. y is flipped since
            // gl_PointCoord's origin is top-left but view-space +y is up.
            vec2 coord = (gl_PointCoord - vec2(0.5)) * 2.0;
            float r2 = dot(coord, coord);
            if (r2 > 1.0) discard;
            vec3 normal = vec3(coord.x, -coord.y, sqrt(1.0 - r2));

            // Real asteroids reflect sunlight rather than glowing on their
            // own — without this every grain read as uniformly "shining"
            // regardless of where the sun actually is. The sun sits close
            // enough to the belt (not "at infinity" the way it effectively
            // is for a body as far out as the Moon) that this genuinely
            // varies with camera position: particles between the camera and
            // the sun show their shadowed side, particles with the sun
            // between them and the camera show their lit side — real
            // physics, not a bug, but a low floor makes the (usually
            // near-camera, most visually prominent) shadowed half of the
            // belt nearly disappear. A real asteroid's night side isn't
            // pure black either (scattered light off the rest of the
            // belt/zodiacal light), which motivates a floor either way —
            // this one's just biased toward staying legible over strict
            // realism, same tradeoff Atmosphere.tsx's untinted night-side
            // floor makes.
            float diffuse = max(dot(normal, vSunDirView), 0.0);
            float lit = mix(0.5, 1.0, diffuse);

            float edgeAlpha = smoothstep(1.0, 0.7, sqrt(r2));
            gl_FragColor = vec4(beltColor * lit * (0.7 + 0.3 * vScale), edgeAlpha * 0.85);
          }
        `}
      />
    </points>
  );
}
