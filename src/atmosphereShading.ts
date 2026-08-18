import { MathUtils } from "three";
import { ATMOSPHERE_MAX_INTENSITY, ATMOSPHERE_MIN_INTENSITY } from "./astronomy";

// Shared by the atmosphere shell (Atmosphere) and the surface rim glow
// (TexturedSurface) so both derive "how strong does this planet's glow
// read" from the same real relativeSurfacePressure value — see
// PlanetAtmosphereData.relativeSurfacePressure's comment for why sqrt+clamp
// rather than the raw ratio.
export function atmosphereIntensity(relativeSurfacePressure: number): number {
  return MathUtils.clamp(Math.sqrt(relativeSurfacePressure), ATMOSPHERE_MIN_INTENSITY, ATMOSPHERE_MAX_INTENSITY);
}

// Shared day/night law for every terminator-driven shader in this app —
// Planet's Atmosphere shell, its TexturedSurface's surface reinforcement,
// and Moon's MoonSurface eclipse shading: fully lit whenever the sun is
// above the local horizon (angle between the light ray and the surface
// normal <= 90°, i.e. dot(N, sunDir) >= 0), reaching its night-side state by
// 5° past that. A sharp cutoff right at the horizon, not a broad
// half-lambert. Lives here (not Planet/) despite the name, and despite the
// Moon having no atmosphere of its own, because MoonSurface's eclipse
// shading reuses this exact same fade band — see that component's own
// comment.
export const ATMOSPHERE_TERMINATOR_FADE_DOT = Math.cos((95 * Math.PI) / 180); // dot(N, sunDir) at 5° past the terminator, ≈ -0.0872
