import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { Group, Mesh } from "three";
import { Billboard } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { ANGULAR_THRESHOLD, MIN_VIEW_MULTIPLIER, PLACEHOLDER_SIZE, SUN_DATA, SUN_RADIUS, VIEW_MULTIPLIER } from "./astronomy";
import { simulation } from "./simulation";
import { FRAME_PRIORITY } from "./framePriority";
import { BodyLabel } from "./BodyLabel";
import { hoverCursor } from "./sceneCommon";
import type { OnFocus } from "./sceneCommon";
import { isSunOccluded } from "./sunProperties";
import { SunGlare } from "./Sun/SunGlare";

export function Sun({
  selected,
  showPlaceholder,
  showLabel,
  onFocus,
}: {
  selected: boolean;
  showPlaceholder: boolean;
  showLabel: boolean;
  onFocus: OnFocus;
}) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const placeholder = useRef<Mesh>(null);
  const selectionRing = useRef<Mesh>(null);
  const switchDistance = SUN_RADIUS / ANGULAR_THRESHOLD;
  // Preallocated scratch vectors for isSunOccluded — mutated every frame,
  // never reassigned, so this doesn't allocate per frame.
  const toSun = useRef(new Vector3());
  const toBody = useRef(new Vector3());
  const closestPoint = useRef(new Vector3());

  useFrame((_, delta) => {
    // Sun's rotation should follow the simulation clock so its visible
    // rotation speed matches the playback/time-scale control.
    if (mesh.current) mesh.current.rotation.y += 0.05 * delta * simulation.speed;
  }, FRAME_PRIORITY.updatePosition);

  // Runs after CameraRig — see the matching comment in Planet.
  useFrame((state) => {
    if (!group.current) return;

    const distance = state.camera.position.distanceTo(group.current.position);
    // Unlike planets, the sun doesn't need the "keep the real mesh visible
    // even past switchDistance so there's *something* there" placeholders-off
    // fallback: SunGlare is a proper stand-in at any distance, not just an
    // honest-but-tiny dot — except when the sun is actually occluded (a
    // transit): SunGlare hides itself outright then (see its own comment),
    // so the real mesh takes back over as the fallback, same as up close.
    // It's still real, depth-tested geometry (unlike the placeholder discs),
    // so a genuine transit correctly hides it too — this isn't overriding
    // that, just making it eligible to be tested again instead of forcing
    // it off by distance alone.
    const occluded = isSunOccluded(state.camera.position, toSun.current, toBody.current, closestPoint.current);
    const showReal = distance < switchDistance || occluded;
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
    // See Planet's own handleFocus for why this check exists — also covers
    // SunGlare's own occlusion-driven .visible (a real transit shouldn't be
    // clickable through the planet blocking it).
    if (!event.eventObject.visible) return;
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
      <SunGlare onClick={handleFocus} />
      <mesh ref={mesh} onClick={handleFocus} {...hoverCursor}>
        <sphereGeometry args={[SUN_RADIUS, 100, 100]} />
        <meshBasicMaterial color="#fff4d9" />
      </mesh>
      <Billboard>
        <mesh ref={placeholder} onClick={handleFocus} {...hoverCursor}>
          <circleGeometry args={[1, 24]} />
          <meshBasicMaterial
            color="#fff4d9"
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </mesh>
        <mesh ref={selectionRing}>
          <ringGeometry args={[1.4, 1.7, 32]} />
          <meshBasicMaterial
            color="#ffffff"
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </mesh>
      </Billboard>
      {showLabel ? <BodyLabel id={SUN_DATA.id} selected={selected} /> : null}
    </group>
  );
}
