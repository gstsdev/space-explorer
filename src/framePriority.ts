// R3F runs useFrame subscribers in ascending priority order each tick (lower
// runs first), so these stages turn the frame into an explicit pipeline:
// time advances, then bodies move, then the camera catches up to wherever
// they now are, then (and only then) LOD swaps decide mesh vs. placeholder.
// Without this, a planet's LOD check could compare its brand-new position
// against the camera's position from before it moved — a gap that's
// imperceptible at low playback speed but, at very high speeds, can be
// larger than the LOD switch distance itself, causing visible flicker.
//
// All values must stay <= 0: R3F treats any *positive* priority as an opt-in
// to manual rendering (it stops auto-calling gl.render), which we don't want.
export const FRAME_PRIORITY = {
  advanceTime: -30,
  updatePosition: -20,
  // Earth's eclipse-shadow shader needs the Moon's live world position (to
  // test whether the Moon blocks the sun from a given point on Earth's
  // surface) — the Moon writes it here, strictly after every body's own
  // updatePosition (so it reads Earth's *this-frame* position, not last
  // frame's) and strictly before anything downstream reads it. See Moon.tsx
  // and Planet.tsx.
  updateShadowCasters: -15,
  updateCamera: -10,
  updateVisibility: 0,
} as const;
