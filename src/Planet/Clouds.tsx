import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, ShaderMaterial, Vector3 } from "three";
import type { Mesh } from "three";
import type { PlanetCloudsData } from "../astronomy";
import { simulation } from "../simulation";
import { FRAME_PRIORITY } from "../framePriority";
import { ATMOSPHERE_TERMINATOR_FADE_DOT } from "../atmosphereShading";
import type { Quality } from "../quality";

// See PlanetCloudsData's own comment for why this is procedural rather than
// a real satellite cloud-cover texture. A thin shell just outside the
// surface (same BackSide-free, FrontSide-default sphere every other body's
// real mesh uses — unlike Atmosphere, this isn't a glow you see the far
// inside face of, it's meant to read as an opaque-ish layer wrapping the
// ground), shaded with fractal noise sampled directly in 3D by each
// fragment's own (object-space, == world-space — see localSunDirection's
// comment on Planet) surface normal rather than a 2D UV, so there's no
// seam or pole-pinch the way a 2D noise texture would show at the sphere's
// poles. The noise field is continuously offset by simulation.time, so the
// whole pattern drifts and morphs rather than sitting frozen — never
// repeating, and (deliberately, see PlanetCloudsData) not standing in for
// any real date's actual cloud cover.
//
// Real cloud tops are ~0.19% of Earth's radius — this is a few times that,
// still a thin shell close to the ground rather than Atmosphere's own
// (~1.6%) exaggeration, which this doesn't need now that the shell renders
// correctly at any thickness. (A too-thin gap was the first suspect when
// this shell was initially invisible except at the silhouette — but the
// real cause was App.tsx's logarithmicDepthBuffer: a hand-rolled
// gl_Position, unlike a built-in material's, doesn't get the log-depth
// adjustment for free, so this shell's depth didn't actually match what the
// opaque surface underneath had written and lost the depth test almost
// everywhere except the rim, where there was no opaque fragment to lose
// against. Fixed below via the standard logdepthbuf_* chunks, the same way
// Three's own built-in materials handle it internally — see this file's
// vertex/fragment shader for where those are included. Atmosphere.tsx and
// SunGlare.tsx have the same hand-rolled gl_Position and are presumably
// affected too, just invisibly: Atmosphere's rim-only look was already the
// intended design regardless, and SunGlare's depthTest is only ever
// exercised at extreme distances where sub-body-radius depth error is
// unlikely to matter — neither has been fixed here, out of scope for this
// change.)
const CLOUD_SHELL_RATIO = 1.003;

// Larger = smaller, more numerous cloud clusters. Eyeballed against the
// running app.
const CLOUD_NOISE_SCALE = 3.2;

// Domain-warp strength: how far the main noise's sample point gets
// displaced by a second, independent noise field (see the shader's own
// warpedPoint line) before the actual cloud pattern is sampled there. Plain
// FBM alone is rotationally symmetric by construction, so it can only ever
// produce round-ish blobs — real cloud cover is dominated by elongated
// frontal bands and cyclonic spirals from actual fluid dynamics, which
// warping approximates cheaply by stretching/curling the blobs into
// flowing shapes instead. 0 disables it entirely (back to isotropic blobs).
const CLOUD_WARP_STRENGTH = 0.5;

// How fast the noise field drifts, in noise-space units per simulated
// second. simulation.time is seconds since J2000.0 — potentially a very
// large number, especially after a long session at high playback speed —
// so it's wrapped (see the shader's own uTime line) before being scaled by
// this, keeping the value float32-precision-safe rather than eventually
// going jittery or freezing as it grows.
const CLOUD_DRIFT_SPEED = 0.00006;

// Threshold band the (roughly [0,1]-remapped) noise value has to cross to
// read as cloud rather than clear sky — see the shader's own coverage line.
// CLOUD_COVERAGE is the band's center, CLOUD_EDGE_SOFTNESS its half-width.
const CLOUD_COVERAGE = 0.6;
const CLOUD_EDGE_SOFTNESS = 0.2;

// Max opacity at full coverage — under 1 so the surface (and, at the
// silhouette, space) still shows faintly through even the densest clusters,
// closer to how real cloud tops read from orbit than a flat opaque layer.
const CLOUD_OPACITY = 0.85;

// Same day/night law as every other terminator-driven effect in this app
// (see ATMOSPHERE_TERMINATOR_FADE_DOT) — clouds are lit by the same sun,
// after all — but with their own, much less aggressive night floor: unlit
// clouds still reflect a fair amount of ambient/scattered light in real
// photos rather than going near-black.
const CLOUD_NIGHT_DARKEN = 0.1;

// fbm's octave count and the domain-warp offset's own noise cost are the
// two knobs that make this shader either the original full-detail version
// or the cut-down one that a low-end mobile GPU (a Galaxy A16/Mali-G57
// crashed/struggled otherwise — see quality.ts) can actually run at
// interactive framerates once Earth's cloud shell fills a meaningful chunk
// of the screen. Baked into the GLSL source string in JS rather than driven
// by a uniform/dynamic loop bound — Clouds is remounted (via a `key` on
// `quality` at the call site) on a tier change, so there's no need for the
// shader itself to branch at runtime, and fixed loop bounds sidestep any
// mobile-driver quirks around variable ones.
function fbmOctaves(quality: Quality): number {
  return quality === "high" ? 5 : 2;
}

// "high": the original three fbm() calls (this is what the warp offset
// looked like before this session's mobile perf pass). "low": three raw,
// single-octave snoise() calls instead — the offset just needs to bend the
// field into organic streaks, it doesn't need fbm's extra high-frequency
// layers to read as a warp, and cutting them was 9 of the 12 total
// snoise() evals/fragment this replaced. Scaled by 0.5 to match fbm's own
// dominant (largest-amplitude) first octave, keeping the warp strength
// close to the "high" look.
function warpOffsetGlsl(quality: Quality): string {
  if (quality === "high") {
    return `vec3 warpOffset = vec3(
      fbm(samplePoint + vec3(37.2, 11.4, 5.1)),
      fbm(samplePoint + vec3(3.5, 91.2, 22.8)),
      fbm(samplePoint + vec3(71.1, 4.9, 63.3))
    );`;
  }
  return `vec3 warpOffset = 0.5 * vec3(
    snoise(samplePoint + vec3(37.2, 11.4, 5.1)),
    snoise(samplePoint + vec3(3.5, 91.2, 22.8)),
    snoise(samplePoint + vec3(71.1, 4.9, 63.3))
  );`;
}

export function Clouds({
  clouds,
  radius,
  sunDirection,
  meshRef,
  quality,
}: {
  clouds: PlanetCloudsData;
  radius: number;
  sunDirection: RefObject<Vector3>;
  // Planet's own LOD/visibility useFrame writes this shell's .visible
  // directly (see that ref's own comment on Planet) — this component has
  // no LOD logic of its own, it just needs to expose its mesh for that.
  meshRef: RefObject<Mesh | null>;
  quality: Quality;
}) {
  const material = useRef<ShaderMaterial>(null);
  const cloudColor = useMemo(() => new Color(clouds.color), [clouds.color]);

  useFrame(() => {
    if (!material.current) return;
    material.current.uniforms.sunDirection.value.copy(sunDirection.current);
    material.current.uniforms.uTime.value = simulation.time;
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius * CLOUD_SHELL_RATIO, 100, 100]} />
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        uniforms={{
          sunDirection: { value: new Vector3(0, 0, 1) },
          uTime: { value: 0 },
          cloudColor: { value: cloudColor },
        }}
        vertexShader={`
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }
        `}
        fragmentShader={`
          #include <common>
          #include <logdepthbuf_pars_fragment>
          varying vec3 vNormal;
          uniform vec3 sunDirection;
          uniform float uTime;
          uniform vec3 cloudColor;

          // Standard public-domain 3D simplex noise (Ashima Arts / Ian
          // McEwan's webgl-noise) — the same well-known building block
          // behind most procedural terrain/cloud shaders, used here
          // unmodified rather than re-derived.
          vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
          vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

          float snoise(vec3 v) {
            const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = mod289(i);
            vec4 p = permute(permute(permute(
                       i.z + vec4(0.0, i1.z, i2.z, 1.0))
                     + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                     + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            vec4 s0 = floor(b0) * 2.0 + 1.0;
            vec4 s1 = floor(b1) * 2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
            p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
          }

          // Fractional Brownian motion: each octave higher-frequency and
          // lower-amplitude than the last — a single octave of simplex
          // noise looks like uniform blobs, this layering is what gives it
          // the wispy, detailed-at-every-scale look real clouds have. See
          // fbmOctaves()'s own comment for why the octave count is a
          // quality-tier constant baked in here rather than a uniform.
          float fbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < ${fbmOctaves(quality)}; i++) {
              value += amplitude * snoise(p);
              p *= 2.0;
              amplitude *= 0.5;
            }
            return value;
          }

          void main() {
            #include <logdepthbuf_fragment>
            // See CLOUD_DRIFT_SPEED's own comment — wrapped to keep this
            // float32-precision-safe regardless of session length/speed.
            float wrappedTime = mod(uTime, 200000.0);
            vec3 samplePoint = vNormal * ${CLOUD_NOISE_SCALE} + vec3(wrappedTime * ${CLOUD_DRIFT_SPEED}, 0.0, 0.0);
            // Domain warp — see CLOUD_WARP_STRENGTH's own comment and
            // warpOffsetGlsl()'s own comment for why its cost varies by
            // quality tier. Each component of the offset comes from noise
            // sampled at a large, arbitrary fixed shift so the three are
            // decorrelated from each other and from the un-warped field
            // itself, rather than all three tracking the same values.
            ${warpOffsetGlsl(quality)}
            vec3 warpedPoint = samplePoint + warpOffset * ${CLOUD_WARP_STRENGTH};
            // fbm's output ranges roughly [-1, 1]; remap to [0, 1] before
            // thresholding below.
            float density = fbm(warpedPoint) * 0.5 + 0.5;
            float coverage = smoothstep(
              ${CLOUD_COVERAGE} - ${CLOUD_EDGE_SOFTNESS},
              ${CLOUD_COVERAGE} + ${CLOUD_EDGE_SOFTNESS},
              density
            );

            float daylight = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(vNormal, normalize(sunDirection)));
            vec3 litColor = mix(cloudColor * ${CLOUD_NIGHT_DARKEN}, cloudColor, daylight);

            gl_FragColor = vec4(litColor, coverage * ${CLOUD_OPACITY});
          }
        `}
      />
    </mesh>
  );
}
