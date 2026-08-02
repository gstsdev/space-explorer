import { useFrame } from "@react-three/fiber";
import { DEFAULT_SPEED_EXPONENT } from "./astronomy";
import { FRAME_PRIORITY } from "./framePriority";

export type SimulationState = {
  time: number; // accumulated simulated seconds, advanced by speed each frame
  speed: number; // playback multiplier; 1 = real time
};

// A single global mutable clock, not React state — it's read up to 60x/sec
// by every orbiting body and written by the speed slider, and routing that
// through React state or context would mean re-rendering the scene every
// frame just to move a number forward.
export const simulation: SimulationState = {
  time: 0,
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
