import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html, Line, useTexture } from "@react-three/drei";
import { AdditiveBlending, MathUtils, ShaderMaterial } from "three";
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
import type { PlanetTextures } from "./astronomy";
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
function TexturedSurface({ textures }: { textures: PlanetTextures }) {
  const maps = useTexture(textures);
  return (
    <meshPhongMaterial
      map={maps.map}
      normalMap={maps.normalMap}
      specularMap={maps.specularMap}
      specular="#333333"
      shininess={15}
    />
  );
}

type PlanetProps = {
  id: string;
  color: string;
  radius: number; // true-scale radius, in scene units
  semiMajorAxis: number; // true-scale orbit size, in scene units
  eccentricity: number; // 0 = circle, closer to 1 = more stretched-out ellipse
  spinSpeed?: number;
  selected: boolean;
  textures?: PlanetTextures;
  onFocus: OnFocus;
};

function Planet({
  id,
  color,
  radius,
  semiMajorAxis,
  eccentricity,
  spinSpeed = 0.5,
  selected,
  textures,
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
  // Ring around the placeholder marking it as the current selection — kept
  // in lockstep with the placeholder's own scale in the same frame, below.
  const selectionRing = useRef<Mesh>(null);

  const period = 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / GM_SUN_SCALED);
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity ** 2);
  // Distance at which the body's angular size crosses the "readable" threshold.
  const switchDistance = radius / ANGULAR_THRESHOLD;

  // Trace the same ellipse the planet moves along, so the orbit path is
  // visible even though it's a static line (not an actual fading trail).
  const orbitPoints = useMemo(() => {
    const segments = 1024;
    return Array.from({ length: segments + 1 }, (_, i) => {
      const E = (i / segments) * Math.PI * 2;
      return [
        semiMajorAxis * (Math.cos(E) - eccentricity),
        0,
        semiMinorAxis * Math.sin(E),
      ] as [number, number, number];
    });
  }, [semiMajorAxis, eccentricity, semiMinorAxis]);

  // Runs before CameraRig: advances this planet along its orbit for the
  // current frame using this frame's already-advanced simulation time (see
  // FRAME_PRIORITY — SimulationClock runs even earlier).
  useFrame((_, delta) => {
    if (!group.current) return;

    // Mean anomaly: where the planet would be if it moved at constant speed
    // around the orbit. Just elapsed-time-as-a-fraction-of-one-lap, in radians.
    // Uses the shared simulation clock (real seconds × playback speed), not
    // the render clock, so the speed slider affects every body in lockstep.
    const meanAnomaly = ((simulation.time / period) * 2 * Math.PI) % (2 * Math.PI);
    const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, eccentricity);

    // Converting eccentric anomaly to an (x, z) point on the ellipse. The sun
    // sits at the ellipse's focus, not its center, so the center is offset by
    // a·e — this is what makes the planet speed up near the sun (perihelion)
    // and slow down far from it (aphelion), per Kepler's second law, without
    // us ever simulating a force.
    group.current.position.set(
      semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
      0,
      semiMinorAxis * Math.sin(eccentricAnomaly),
    );

    if (mesh.current) mesh.current.rotation.y += spinSpeed * delta;
  }, FRAME_PRIORITY.updatePosition);

  // Runs after CameraRig: by now the camera has already caught up to this
  // frame's (fresh) planet position, so this distance check can't read a
  // stale camera position — see FRAME_PRIORITY for why that split matters.
  useFrame((state) => {
    if (!group.current) return;

    const distance = state.camera.position.distanceTo(group.current.position);
    const showReal = distance < switchDistance;
    if (mesh.current) mesh.current.visible = showReal;
    if (placeholder.current) {
      placeholder.current.visible = !showReal;
      placeholder.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    if (selectionRing.current) {
      selectionRing.current.visible = !showReal && selected;
      selectionRing.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
  }, FRAME_PRIORITY.updateVisibility);

  const handleFocus = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (group.current) onFocus(group.current, id);
  };

  return (
    <>
      <Line
        points={orbitPoints}
        color={color}
        transparent
        opacity={selected ? 0.9 : 0.3}
        linewidth={selected ? 2 : 1}
      />
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
              <TexturedSurface textures={textures} />
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
          depthTest={false}
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

function Sun({ selected, onFocus }: { selected: boolean; onFocus: OnFocus }) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const placeholder = useRef<Mesh>(null);
  const selectionRing = useRef<Mesh>(null);
  const switchDistance = SUN_RADIUS / ANGULAR_THRESHOLD;

  useFrame(
    (_, delta) => {
      if (mesh.current) mesh.current.rotation.y += 0.05 * delta;
    },
    FRAME_PRIORITY.updatePosition,
  );

  // Runs after CameraRig — see the matching comment in Planet.
  useFrame((state) => {
    if (!group.current) return;

    const distance = state.camera.position.distanceTo(group.current.position);
    const showReal = distance < switchDistance;
    if (mesh.current) mesh.current.visible = showReal;
    if (placeholder.current) {
      placeholder.current.visible = !showReal;
      placeholder.current.scale.setScalar(distance * PLACEHOLDER_SIZE);
    }
    if (selectionRing.current) {
      selectionRing.current.visible = !showReal && selected;
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

export function Scene({ selectedId, onFocus }: { selectedId: string | null; onFocus: OnFocus }) {
  return (
    <>
      <Sun selected={selectedId === SUN_DATA.id} onFocus={onFocus} />
      {PLANETS.map((planet) => (
        <Planet
          key={planet.id}
          id={planet.id}
          color={planet.color}
          radius={planet.radiusKm * KM_TO_UNITS}
          semiMajorAxis={planet.semiMajorAxisKm * KM_TO_UNITS}
          eccentricity={planet.eccentricity}
          selected={selectedId === planet.id}
          textures={planet.textures}
          onFocus={onFocus}
        />
      ))}
    </>
  );
}
