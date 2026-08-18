import { Vector3 } from "three";

// Live positions/radii of every planet, kept in sync by each Planet's own
// per-frame position update (FRAME_PRIORITY.updatePosition) and read by both
// SunGlare and Sun (FRAME_PRIORITY.updateVisibility, so always after) to
// test whether a planet is currently transiting between the camera and the
// sun. A plain mutable array of pre-allocated Vector3s — same rationale as
// `simulation` in simulation.ts — avoids both per-frame allocation and
// routing this through React state/context just to advance some numbers.
export type OcclusionBody = { position: Vector3; radius: number };
export const sunOcclusionBodies: OcclusionBody[] = [];

// True if some planet's real body currently sits on the line between the
// camera and the sun's center (a transit) — i.e. the sun is genuinely
// blocked from view, not approximated by a depth test against a
// screen-space billboard (see SunGlare — its rays reach well past any
// planet's on-screen silhouette, so per-pixel depth testing alone can't
// hide the whole effect). toSun/toBody/closestPoint are caller-owned
// scratch vectors, mutated here rather than allocated, since every caller
// runs this every frame.
export function isSunOccluded(
  cameraPosition: Vector3,
  toSun: Vector3,
  toBody: Vector3,
  closestPoint: Vector3,
): boolean {
  const distanceToSun = cameraPosition.length(); // the sun is always at the origin
  toSun.copy(cameraPosition).multiplyScalar(-1).normalize();
  for (const body of sunOcclusionBodies) {
    toBody.subVectors(body.position, cameraPosition);
    const t = toBody.dot(toSun);
    if (t <= 0 || t >= distanceToSun) continue; // body isn't between camera and sun
    closestPoint.copy(toSun).multiplyScalar(t).add(cameraPosition);
    if (closestPoint.distanceTo(body.position) < body.radius) return true;
  }
  return false;
}
