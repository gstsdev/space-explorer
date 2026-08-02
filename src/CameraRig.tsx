import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import type { Object3D, PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FRAME_PRIORITY } from "./framePriority";
import { MIN_VIEW_MULTIPLIER, SUN_RADIUS, VIEW_MULTIPLIER } from "./astronomy";

// Every focusable body stashes how many of its own radii away the camera
// should park, and how close it's allowed to get (see userData.focusDistance
// / userData.minViewDistance in Scene.tsx) — real planets are tiny, so "8
// radii from Mars" and "8 radii from the sun" are wildly different absolute
// distances, but both read as "a good look at the body." These are the
// fallbacks for when nothing is focused (focusTarget is null), which by
// convention means "looking at the sun" — so they mirror the sun's own values.
const DEFAULT_FOCUS_DISTANCE = SUN_RADIUS * VIEW_MULTIPLIER;
const DEFAULT_MIN_DISTANCE = SUN_RADIUS * MIN_VIEW_MULTIPLIER;

// How long, after clicking a body, the camera actively dollies toward it.
// After this, distance is handed back to the user's own scroll-zoom —
// otherwise we'd fight every zoom attempt by continuously pulling the
// camera back to focusDistance.
const TRANSITION_DURATION = 1.5;

// OrbitControls.zoomSpeed multiplies the dolly scale applied per wheel
// event (regardless of that event's deltaY magnitude — see
// three-stdlib's OrbitControls, dollyIn/dollyOut always use getZoomScale()).
// Bodies span orders of magnitude in true scale, so a single fixed zoomSpeed
// is either too slow to cross that range or too twitchy up close. Instead we
// ramp zoomSpeed up while wheel events keep arriving in a tight burst, and
// let it reset the moment scrolling pauses.
const BASE_ZOOM_SPEED = 1;
const MAX_ZOOM_ACCEL = 5;
const ZOOM_ACCEL_STEP = 0.6;
const ZOOM_BURST_WINDOW_MS = 220;

// The system spans real scale from a planet's own radius (thousandths of a
// unit) out to Neptune's orbit (thousands of units) — no single fixed near
// plane keeps useful depth precision across that whole range at once. A
// near plane tight enough for close-up planet viewing, left in place while
// zoomed out to Saturn/Uranus/Neptune's distance, stretches the near:far
// ratio so far that depth precision collapses and geometry starts dropping
// out. So near scales with the current distance to the orbit target instead
// of staying fixed.
//
// far, on the other hand, must stay fixed but comfortably cover the worst
// case: the camera can sit up to maxDistance (6000) from its target, and the
// target itself can be up to Neptune's aphelion (~4566 units) from the sun —
// so the far side of Neptune's orbit line can be up to roughly
// 6000 + 4566 + 4566 ≈ 15,100 units from the camera. 10,000 clipped that,
// which showed up as a gap in the orbit line (not a camera-angle bug).
const MIN_NEAR = 0.001;
const NEAR_RATIO = 0.001;
export const CAMERA_FAR = 20_000;

export function CameraRig({ focusTarget }: { focusTarget: RefObject<Object3D | null> }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const desiredTarget = useRef(new Vector3());
  const direction = useRef(new Vector3());
  const targetDelta = useRef(new Vector3());
  const previousTarget = useRef<Object3D | null>(null);
  const focusChangedAt = useRef(0);
  const domElement = useThree((state) => state.gl.domElement);

  useEffect(() => {
    let lastWheelTime = 0;
    let accel = 0;

    const handleWheel = () => {
      const c = controls.current;
      if (!c) return;
      const now = performance.now();
      accel = now - lastWheelTime < ZOOM_BURST_WINDOW_MS ? Math.min(accel + ZOOM_ACCEL_STEP, MAX_ZOOM_ACCEL) : 0;
      lastWheelTime = now;
      c.zoomSpeed = BASE_ZOOM_SPEED + accel;
    };

    domElement.addEventListener("wheel", handleWheel, { passive: true });
    return () => domElement.removeEventListener("wheel", handleWheel);
  }, [domElement]);

  useFrame((state, delta) => {
    const c = controls.current;
    if (!c) return;

    const target = focusTarget.current;

    if (target !== previousTarget.current) {
      previousTarget.current = target;
      focusChangedAt.current = state.clock.elapsedTime;
    }

    if (target) target.getWorldPosition(desiredTarget.current);
    else desiredTarget.current.set(0, 0, 0);

    // Target tracking is exact, not smoothed: any lag here is lag behind a
    // moving planet, and once the camera is close (true planet scale is
    // tiny), even a small positional lag is a huge swing on screen — enough
    // that a fast, eccentric orbit like Mercury's would visibly outrun a
    // laggy tracker mid zoom-in. Smoothing is reserved for distance below,
    // which produces the "zooming in" feel without ever risking losing the target.
    targetDelta.current.copy(desiredTarget.current).sub(c.target);
    c.target.add(targetDelta.current);

    // OrbitControls.update() recomputes the camera's offset from (position,
    // target) fresh every call — it does NOT translate position when target
    // moves on its own, it only re-aims via lookAt. So without this, a
    // focused planet would appear to freeze on screen: the camera stays
    // pinned in space while only rotating to track it. Translating position
    // by the same delta as target keeps the camera rigidly riding along.
    state.camera.position.add(targetDelta.current);

    const smoothing = 1 - Math.pow(0.001, delta);
    if (state.clock.elapsedTime - focusChangedAt.current < TRANSITION_DURATION) {
      const desiredDistance =
        (target?.userData.focusDistance as number | undefined) ?? DEFAULT_FOCUS_DISTANCE;
      const currentDistance = state.camera.position.distanceTo(c.target);
      const nextDistance = currentDistance + (desiredDistance - currentDistance) * smoothing;

      direction.current.copy(state.camera.position).sub(c.target).normalize();
      state.camera.position.copy(c.target).addScaledVector(direction.current, nextDistance);
    }

    // Must stay dynamic, not a fixed prop: a fixed minDistance small enough
    // for tiny Mercury would let the camera fly inside a much bigger body
    // like Jupiter or the sun, which reads as clipping.
    c.minDistance = (target?.userData.minViewDistance as number | undefined) ?? DEFAULT_MIN_DISTANCE;

    c.update();

    const camera = state.camera as PerspectiveCamera;
    const nextNear = Math.max(MIN_NEAR, state.camera.position.distanceTo(c.target) * NEAR_RATIO);
    if (camera.near !== nextNear) {
      camera.near = nextNear;
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
  }, FRAME_PRIORITY.updateCamera);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      // minDistance is overridden every frame above, per focused body.
      minDistance={DEFAULT_MIN_DISTANCE}
      maxDistance={6000}
      // OrbitControls' own pole guard (Spherical.makeSafe) only keeps ~1e-6
      // radians of margin from straight up/down — nowhere near enough to
      // avoid the numerical instability in Object3D.lookAt() when the view
      // direction is nearly parallel to the world-up axis, which showed up
      // as geometry vanishing near screen center at those angles. This
      // keeps a real margin (~5.7°) from both poles.
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI - 0.1}
    />
  );
}