// Every size, distance, and orbital period below is a real astronomical
// value (or derived from one), converted to scene units by the same factor —
// so relative proportions and timing are physically accurate. Only playback
// speed (see SimulationContext) is a user-facing artistic control on top.
export const KM_TO_UNITS = 1 / 1_000_000; // 1 scene unit = 1,000,000 km

export const SUN_RADIUS_KM = 696_000;
export const SUN_RADIUS = SUN_RADIUS_KM * KM_TO_UNITS;

// The sun's real standard gravitational parameter, μ = GM, in km³/s². Powers
// Kepler's third law (T = 2π√(a³/μ)) so orbital periods come out as real
// seconds — Mercury's falls out to ~88 days, Earth's to ~365.25, etc. —
// without hardcoding periods separately from the semi-major axes below.
export const GM_SUN_KM3_S2 = 132_712_440_018;

// Scaled by KM_TO_UNITS³ to match the scene-unit semi-major axes used for
// rendering (a³/μ is scale-invariant as long as both use the same factor).
export const GM_SUN_SCALED = GM_SUN_KM3_S2 * KM_TO_UNITS ** 3;

// Real orbital period in days, straight from Kepler's third law — used for
// display (the stats panel), independent of the scene-unit math above.
export function orbitalPeriodDays(semiMajorAxisKm: number) {
  const seconds = 2 * Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / GM_SUN_KM3_S2);
  return seconds / 86_400;
}

// How many body-radii away the camera parks when focused on that body.
export const VIEW_MULTIPLIER = 8;

// Closest the camera is allowed to get when focused on a body, in body-radii
// from its center. Must stay well above 1 (the surface) — a fixed minimum
// distance (e.g. one small enough for tiny Mercury) would let the camera fly
// inside a much bigger body like Jupiter or the sun, which reads as clipping.
export const MIN_VIEW_MULTIPLIER = 3;

// Below this angular size (radians, radius/distance), a body is too small to
// read as a sphere and renders as a flat, constant-size placeholder instead.
export const ANGULAR_THRESHOLD = 0.02;

// Scale factor for the placeholder's on-screen size (distance * this = world scale).
export const PLACEHOLDER_SIZE = 0.01;

export const SECONDS_PER_YEAR = 31_557_600; // Julian year

// Playback speed slider: real orbital periods run from ~88 days (Mercury) to
// ~687 days (Mars), so 1x (true real time) is imperceptibly slow to watch.
// The slider is log-scaled — exponent 0..MAX_SPEED_EXPONENT maps to
// 10^0..10^MAX_SPEED_EXPONENT — since the useful range spans orders of
// magnitude. Capped at 10 years/second: past that, Mercury's 88-day orbit
// completes in under a frame at 60fps and stops reading as motion at all —
// this is roughly where it starts strobing rather than orbiting smoothly.
export const MAX_SPEED_EXPONENT = Math.log10(10 * SECONDS_PER_YEAR);

// Default sits well below the (now much higher) max, at the pacing the scene
// originally shipped with (Mercury ~7.6s/lap, Earth ~31.6s/lap) — the max is
// an extreme "fast-forward to watch Neptune move" ceiling, not something the
// app should open already running at.
export const DEFAULT_SPEED_EXPONENT = 6;

// A planet's full texture set — deliberately all-or-nothing (rather than
// each map individually optional) since specular/normal maps are meaningless
// without the base color map, and it keeps the loading code in Scene.tsx simple.
export type PlanetTextures = {
  map: string;
  normalMap?: string;
  specularMap?: string;
};

export type PlanetData = {
  id: string;
  color: string;
  radiusKm: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  textures?: PlanetTextures;
};

export const SUN_DATA = { id: "sun", color: "#ffcc66", radiusKm: SUN_RADIUS_KM };

export const KM_PER_AU = 149_597_870.7;

export const PLANETS: PlanetData[] = [
  { id: "mercury", color: "#8c8c8c", radiusKm: 2439.7, semiMajorAxisKm: 57_909_050, eccentricity: 0.2056 },
  { id: "venus", color: "#e0a96d", radiusKm: 6051.8, semiMajorAxisKm: 108_208_000, eccentricity: 0.0068 },
  { id: "earth", color: "#4d90fe", radiusKm: 6371, semiMajorAxisKm: 149_598_023, eccentricity: 0.0167 },
  { id: "mars", color: "#c1440e", radiusKm: 3389.5, semiMajorAxisKm: 227_939_200, eccentricity: 0.0934 },
  { id: "jupiter", color: "#d9b384", radiusKm: 69_911, semiMajorAxisKm: 778_479_000, eccentricity: 0.0489 },
  { id: "saturn", color: "#e3c78a", radiusKm: 58_232, semiMajorAxisKm: 1_432_041_000, eccentricity: 0.0565 },
  { id: "uranus", color: "#a8ddec", radiusKm: 25_362, semiMajorAxisKm: 2_867_043_000, eccentricity: 0.0457 },
  { id: "neptune", color: "#4169c9", radiusKm: 24_622, semiMajorAxisKm: 4_514_953_000, eccentricity: 0.0113 },
];
