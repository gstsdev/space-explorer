import { useFrame } from "@react-three/fiber";
import { DEFAULT_SPEED_EXPONENT, secondsSinceJ2000 } from "./astronomy";
import { FRAME_PRIORITY } from "./framePriority";

export type SimulationState = {
  time: number; // seconds since the J2000.0 epoch, advanced by speed each frame
  speed: number; // playback multiplier; 1 = real time
};

// A single global mutable clock, not React state — it's read up to 60x/sec
// by every orbiting body and written by the speed slider, and routing that
// through React state or context would mean re-rendering the scene every
// frame just to move a number forward.
//
// Seeded to the real elapsed time since J2000.0 (rather than 0) so the app
// opens with every planet at its actual current position — each body's
// per-frame mean anomaly combines this with its real mean anomaly at that
// same epoch (see PlanetData.meanAnomalyAtEpochDegrees).
export const simulation: SimulationState = {
  time: secondsSinceJ2000(),
  speed: 10 ** DEFAULT_SPEED_EXPONENT,
};

// Advances the shared simulation clock every frame. Mounted once inside the
// Canvas; every orbiting body reads simulation.time instead of the raw
// render clock, so they all stay in lockstep and speed changes apply
// uniformly without snapping any body to a different orbital phase.
export function SimulationClock() {
  useFrame(
    (_, delta) => {
      simulation.time += delta * simulation.speed;
    },
    FRAME_PRIORITY.advanceTime,
  );
  return null;
}
