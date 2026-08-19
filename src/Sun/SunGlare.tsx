import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, MathUtils, ShaderMaterial, Vector3 } from "three";
import type { Mesh } from "three";
import { Billboard } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { ANGULAR_THRESHOLD, SUN_RADIUS, VIEW_MULTIPLIER } from "../astronomy";
import { FRAME_PRIORITY } from "../framePriority";
import { hoverCursor } from "../sceneCommon";
import { isSunOccluded } from "../sunProperties";

// Apparent on-screen size of the glare at switchDistance (where it's fully
// opaque) — see GLARE_DISTANCE_EXPONENT just below for how it scales away
// from that distance. Sized larger than the halo itself needs so the
// diffraction spikes (which reach almost to the quad's edge) have room to
// read as long rays.
const GLARE_SIZE = 0.6;

// How much the glare's world-space size grows with distance, as an exponent
// on (distance / switchDistance): 0 would fix its world size, so its
// apparent/screen size shrinks fully like an ordinary object under
// perspective (∝ 1/distance) — technically the most "physical" choice, but
// past switchDistance it shrinks fast enough to become imperceptible within
// a relatively short distance, when real glare/bloom stays perceptible much
// farther out since it's driven by the source's brightness, not just its
// angular size. 1 would reproduce the old always-constant-screen-size
// behavior (world size ∝ distance) — no shrink at all, which reads as
// wrong from very far away. This sits in between: still shrinks, just
// slower than real perspective would on its own.
const GLARE_DISTANCE_EXPONENT = 0.5;

// Radial cutoff (in the same normalized [-1,1] UV space as the fragment
// shader's `d`) for what counts as a click on the glow itself. The quad is
// deliberately oversized so the diffraction spikes have room to read as long
// rays (see GLARE_SIZE above), but those spikes shouldn't be clickable —
// otherwise the glare's hit area would reach almost to the quad's edge in
// eight directions, stealing clicks meant for whatever's behind it (e.g. the
// placeholder dot). Hit-testing is a plain circle around the core rather
// than trying to match the spikes' star shape.
const GLARE_CLICK_RADIUS = 0.35;

// A soft, screen-space-sized glow standing in for the sun's glare as seen
// from realistic (planet-scale) distances — real cameras and eyes see a
// bright point source with a halo much bigger than its actual angular disk.
// Fades out over the same distance range the LOD system already uses to
// swap the sun's real mesh in for its placeholder, so the flat glow never
// overlaps the literal sphere geometry once you're that close.
export function SunGlare({ onClick }: { onClick: (event: ThreeEvent<MouseEvent>) => void }) {
  const mesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);
  const switchDistance = SUN_RADIUS / ANGULAR_THRESHOLD;
  const focusDistance = SUN_RADIUS * VIEW_MULTIPLIER;
  // Preallocated scratch vectors for the occlusion test below — mutated
  // every frame, never reassigned, so this doesn't allocate per frame.
  const toSun = useRef(new Vector3());
  const toBody = useRef(new Vector3());
  const closestPoint = useRef(new Vector3());

  useFrame((state) => {
    if (!mesh.current || !material.current) return;

    const cameraPosition = state.camera.position;
    const distance = cameraPosition.length(); // the sun is always at the origin
    mesh.current.scale.setScalar(
      switchDistance * GLARE_SIZE * (distance / switchDistance) ** GLARE_DISTANCE_EXPONENT,
    );

    // The glare is a screen-space billboard, not real geometry — depthTest
    // alone only clips the parts of its quad literally behind a planet's
    // mesh, leaving the rest of its rays (which reach well past any
    // planet's silhouette) visibly floating in front of it. Since the
    // glare stands in for a single point source, if that point is blocked
    // at all, the whole effect should disappear, so this instead tests the
    // camera→sun line itself (isSunOccluded) for a real transit, independent
    // of pixel depth.
    const occluded = isSunOccluded(cameraPosition, toSun.current, toBody.current, closestPoint.current);
    mesh.current.visible = !occluded;
    if (occluded) return;

    const t = MathUtils.clamp((distance - focusDistance) / (switchDistance - focusDistance), 0, 1);
    material.current.uniforms.opacity.value = t * t * (3 - 2 * t); // smoothstep
  }, FRAME_PRIORITY.updateVisibility);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    // event.uv is undefined only if the geometry lacks UVs, which
    // planeGeometry never does — the guard is just to satisfy the type.
    if (!event.uv) return;
    const d = Math.hypot((event.uv.x - 0.5) * 2, (event.uv.y - 0.5) * 2);
    // Outside the core radius: don't stopPropagation (that's onClick's job),
    // so the click passes through to whatever else the ray hit.
    if (d > GLARE_CLICK_RADIUS) return;
    onClick(event);
  };

  return (
    <Billboard>
      <mesh ref={mesh} onClick={handleClick} {...hoverCursor}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={material}
          transparent
          depthWrite={false}
          // Depth-tested (unlike the placeholder discs) so a body actually
          // in front — a transit — correctly occludes the glare. Safe from
          // the real mesh punching a hole in its own core: Sun now hides
          // that mesh past switchDistance instead of leaving it visible as
          // a stray depth-blocking dot (see the Sun component).
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
              vec2 p = (vUv - 0.5) * 2.0;
              float d = length(p);
              float angle = atan(p.y, p.x);

              // Round halo — same soft falloff as before, just tighter, so
              // it reads as a core glow rather than the whole effect.
              float halo = pow(clamp(1.0 - d, 0.0, 1.0), 4.0);

              // Diffraction-spike starburst, like a camera lens/eye sees
              // looking straight at an unfiltered point-source sun: eight
              // thick primary spikes, eight thinner secondary ones sitting
              // exactly in the gaps between those, and sixteen very thin
              // tertiary ones filling the gaps that remain — 32 evenly-
              // spaced rays in total. For cos(k·angle + c), the peaks land
              // at angle = nπ/k − c/k, i.e. shifted by c/k from the
              // unshifted (c=0) set — so c=π/2 always lands each layer
              // exactly halfway between the previous layer's peaks,
              // regardless of that layer's own k. All fade out with radius
              // (the tertiary set fastest, since real diffraction spikes
              // get thinner as they multiply) so they read as rays rather
              // than a hard cross.
              float radialFade = pow(clamp(1.0 - d, 0.0, 1.0), 0.6);
              float primarySpike = pow(abs(cos(angle * 4.0)), 48.0);
              float secondarySpike = pow(abs(cos(angle * 4.0 + 1.5707963)), 120.0) * 0.5;
              float tertiaryRadialFade = pow(clamp(1.0 - d, 0.0, 1.0), 1.4);
              float tertiarySpike = pow(abs(cos(angle * 8.0 + 1.5707963)), 300.0) * 0.3;
              float spike = (primarySpike + secondarySpike) * radialFade + tertiarySpike * tertiaryRadialFade;

              // A fourth, yellow-tinted set of thin spikes interleaved into
              // the 32-ray set's remaining gaps (k=16, same c=π/2 half-shift
              // trick — 5.625° off every existing ray), like the color
              // fringing a real lens's chromatic aberration adds to its
              // diffraction spikes.
              float colorSpike = pow(abs(cos(angle * 16.0 + 1.5707963)), 250.0) * 0.4 * radialFade;
              vec3 colorSpikeColor = vec3(1.0, 0.82, 0.35);

              // Blown-out white core, fading to a pale warm white halo —
              // real sunlight in space is white, not amber; the warm tint
              // only belongs to the outermost glow.
              float core = pow(clamp(1.0 - d, 0.0, 1.0), 10.0);
              vec3 haloColor = mix(vec3(1.0, 0.93, 0.82), vec3(1.0), clamp(halo + core, 0.0, 1.0));

              // The primary/secondary/tertiary rays themselves fade from
              // white-hot at the core to the same yellow further out, the
              // same chromatic-dispersion look the dedicated color spikes
              // above are standing in for, just applied to the main rays
              // too instead of only the thin ones between them.
              vec3 spikeTint = mix(vec3(1.0), colorSpikeColor, clamp(d, 0.0, 1.0));

              vec3 color = haloColor * halo + spikeTint * spike + vec3(1.0) * core + colorSpikeColor * colorSpike;
              float alpha = clamp(halo + spike + core + colorSpike, 0.0, 1.0);
              gl_FragColor = vec4(color, alpha * opacity);
            }
          `}
        />
      </mesh>
    </Billboard>
  );
}
