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

// J2000.0, the standard epoch real orbital elements (including the mean
// anomalies below) are referenced to: 2000-01-01 12:00 TT, approximated here
// as UTC since the ~64s TT-UTC offset is negligible next to orbital periods
// measured in days/years.
export const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// Seconds elapsed between J2000.0 and the given moment (real wall-clock time
// by default). The simulation clock is seeded with this so "now" maps to
// each planet's actual real-world position, not an arbitrary start pose.
export function secondsSinceJ2000(date: Date = new Date()): number {
  return (date.getTime() - J2000_EPOCH_MS) / 1000;
}

// Playback speed slider: real orbital periods run from ~88 days (Mercury) to
// ~687 days (Mars), so 1x (true real time) is imperceptibly slow to watch.
// The slider is log-scaled — exponent 0..MAX_SPEED_EXPONENT maps to
// 10^0..10^MAX_SPEED_EXPONENT — since the useful range spans orders of
// magnitude. Capped at 10 years/second: past that, Mercury's 88-day orbit
// completes in under a frame at 60fps and stops reading as motion at all —
// this is roughly where it starts strobing rather than orbiting smoothly.
export const MAX_SPEED_EXPONENT = Math.log10(10 * SECONDS_PER_YEAR);

// Default: 1 second of simulated time per real second — true real time, so
// the app opens tracking each planet's actual current position live. The max
// is an extreme "fast-forward to watch Neptune move" ceiling, not something
// the app should open already running at.
export const DEFAULT_SPEED_EXPONENT = 0;

// A planet's full texture set — deliberately all-or-nothing (rather than
// each map individually optional) since specular/normal maps are meaningless
// without the base color map, and it keeps the loading code in Scene.tsx simple.
export type PlanetTextures = {
  map: string;
  normalMap?: string;
  specularMap?: string;
  nightMap?: string;
};

export type PlanetRingData = {
  texture: string;
  innerRadiusRatio: number; // relative to planet radius
  outerRadiusRatio: number; // relative to planet radius
  opacity?: number;
};

export type PlanetData = {
  id: string;
  color: string;
  radiusKm: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  rotationPeriodDays: number;
  axialTiltDegrees?: number;
  // Orbital plane tilt relative to Earth's (the ecliptic) — real orbits
  // aren't coplanar, so without this every planet traces a flat line in the
  // same plane. inclinationDegrees is the tilt itself; ascendingNodeDegrees
  // is which direction (around the vertical axis) that tilt points — two
  // planets can share the same inclination but dip above/below the plane at
  // completely different points in their orbit depending on this.
  inclinationDegrees?: number;
  ascendingNodeDegrees?: number;
  // Real angle (degrees, in the direction of orbital motion) from the
  // ascending node to perihelion — perihelion doesn't generally sit at the
  // ascending node, so without this every orbit implicitly (and wrongly)
  // assumed it did. For Earth specifically this is also what makes the
  // seasons come out real: the axial tilt is only edge-on to the sun (an
  // equinox) when Earth's position lines up with world +X, so this angle is
  // what decides where in the orbit that actually falls. Verified against
  // real JPL Horizons data (both this app's own math replicated in a script,
  // and Mars's real osculating elements directly) across a full year of
  // dates — season/latitude held within ~0.2° throughout.
  argumentOfPeriapsisDegrees?: number;
  // Real mean anomaly (M = mean longitude − longitude of perihelion) at the
  // J2000.0 epoch, in degrees. Combined with secondsSinceJ2000(), this is
  // what lets the simulation clock start at the planet's actual real-world
  // orbital phase instead of everyone lining up at perihelion.
  meanAnomalyAtEpochDegrees?: number;
  // Real IAU prime-meridian rotation angle (W0) at the J2000.0 epoch, in
  // degrees — the axial-spin counterpart to meanAnomalyAtEpochDegrees. A
  // frame mismatch was suspected here early on (W0 is referenced from each
  // body's own ICRF equatorial node, not the vernal equinox this app's world
  // +X otherwise uses) — but for Earth, verified against real JPL data, the
  // real W0 value checks out directly once argumentOfPeriapsisDegrees above
  // is also correct. The apparent mismatch earlier was actually that missing
  // argument of periapsis, not a frame issue — see Earth's comment below.
  rotationAtEpochDegrees?: number;
  textures?: PlanetTextures;
  ring?: PlanetRingData;
};

export const SUN_DATA = {
  id: "sun",
  color: "#ffcc66",
  radiusKm: SUN_RADIUS_KM,
};

export const KM_PER_AU = 149_597_870.7;

export const PLANETS: PlanetData[] = [
  {
    id: "mercury",
    color: "#8c8c8c",
    radiusKm: 2439.7,
    semiMajorAxisKm: 57_909_050,
    eccentricity: 0.2056,
    rotationPeriodDays: 58.646,
    axialTiltDegrees: 0.034,
    inclinationDegrees: 7.005,
    ascendingNodeDegrees: 48.331,
    argumentOfPeriapsisDegrees: 29.127,
    meanAnomalyAtEpochDegrees: 174.796,
    rotationAtEpochDegrees: 329.548,
    textures: {
      map: "/textures/mercury/map.jpg",
    },
  },
  {
    id: "venus",
    color: "#e0a96d",
    radiusKm: 6051.8,
    semiMajorAxisKm: 108_208_000,
    eccentricity: 0.0068,
    rotationPeriodDays: 243.025,
    axialTiltDegrees: 177.36,
    inclinationDegrees: 3.39458,
    ascendingNodeDegrees: 76.68,
    argumentOfPeriapsisDegrees: 54.923,
    meanAnomalyAtEpochDegrees: 50.377,
    rotationAtEpochDegrees: 160.2,
    textures: {
      map: "/textures/venus/map.jpg",
    },
  },
  {
    id: "earth",
    color: "#4d90fe",
    radiusKm: 6371,
    semiMajorAxisKm: 149_598_023,
    eccentricity: 0.0167,
    rotationPeriodDays: 0.99726968,
    axialTiltDegrees: 23.44,
    // Earth's ascendingNodeDegrees is 0 (it defines the reference plane), so
    // this is the full angle from perihelion to the vernal equinox — see
    // PlanetData.argumentOfPeriapsisDegrees; this is the one value in this
    // file directly verified against real JPL sub-solar-point data.
    argumentOfPeriapsisDegrees: 102.938,
    meanAnomalyAtEpochDegrees: 357.527,
    // The real IAU W₀ value — turned out to be correct all along. It was
    // swapped out for GMST₀ (280.461°) earlier under the theory that W₀'s
    // ICRF-node reference frame didn't match this app's vernal-equinox-based
    // world +X. That diagnosis was wrong: the actual bug at the time was the
    // missing argumentOfPeriapsisDegrees above (perihelion was implicitly
    // pinned to the ascending node), and GMST₀ only "worked" by coincidentally
    // absorbing that error. With the real orbit now in place, W₀ checks out
    // directly against real JPL data — no frame conversion needed after all.
    rotationAtEpochDegrees: 190.147,
    textures: {
      map: "/textures/earth/map.jpg",
      normalMap: "/textures/earth/normal.png",
      specularMap: "/textures/earth/specular.png",
      nightMap: "/textures/earth/nightmap.jpg",
    },
  },
  {
    id: "mars",
    color: "#c1440e",
    radiusKm: 3389.5,
    semiMajorAxisKm: 227_939_200,
    eccentricity: 0.0934,
    rotationPeriodDays: 1.025957,
    axialTiltDegrees: 25.19,
    inclinationDegrees: 1.85,
    ascendingNodeDegrees: 49.558,
    argumentOfPeriapsisDegrees: 286.497,
    meanAnomalyAtEpochDegrees: 19.39,
    rotationAtEpochDegrees: 176.63,
    textures: {
      map: "/textures/mars/map.jpg",
    },
  },
  {
    id: "jupiter",
    color: "#d9b384",
    radiusKm: 69_911,
    semiMajorAxisKm: 778_479_000,
    eccentricity: 0.0489,
    rotationPeriodDays: 0.41354,
    axialTiltDegrees: 3.13,
    inclinationDegrees: 1.303,
    ascendingNodeDegrees: 100.464,
    argumentOfPeriapsisDegrees: 274.255,
    meanAnomalyAtEpochDegrees: 19.668,
    rotationAtEpochDegrees: 284.95,
    textures: {
      map: "/textures/jupiter/map.jpg",
    },
  },
  {
    id: "saturn",
    color: "#e3c78a",
    radiusKm: 58_232,
    semiMajorAxisKm: 1_432_041_000,
    eccentricity: 0.0565,
    rotationPeriodDays: 0.44401,
    axialTiltDegrees: 26.73,
    inclinationDegrees: 2.485,
    ascendingNodeDegrees: 113.665,
    argumentOfPeriapsisDegrees: 338.936,
    meanAnomalyAtEpochDegrees: 317.355,
    rotationAtEpochDegrees: 38.9,
    textures: {
      map: "/textures/saturn/map.jpg",
    },
    ring: {
      texture: "/textures/saturn/ring.png",
      innerRadiusRatio: 1.4,
      outerRadiusRatio: 2.6,
      opacity: 0.9,
    },
  },
  {
    id: "uranus",
    color: "#a8ddec",
    radiusKm: 25_362,
    semiMajorAxisKm: 2_867_043_000,
    eccentricity: 0.0457,
    rotationPeriodDays: 0.71833,
    axialTiltDegrees: 97.77,
    inclinationDegrees: 0.773,
    ascendingNodeDegrees: 74.006,
    argumentOfPeriapsisDegrees: 96.937,
    meanAnomalyAtEpochDegrees: 142.284,
    rotationAtEpochDegrees: 203.81,
    textures: {
      map: "/textures/uranus/map.jpg",
    },
  },
  {
    id: "neptune",
    color: "#4169c9",
    radiusKm: 24_622,
    semiMajorAxisKm: 4_514_953_000,
    eccentricity: 0.0113,
    rotationPeriodDays: 0.67125,
    axialTiltDegrees: 28.32,
    inclinationDegrees: 1.77,
    ascendingNodeDegrees: 131.784,
    argumentOfPeriapsisDegrees: 273.181,
    meanAnomalyAtEpochDegrees: 259.915,
    rotationAtEpochDegrees: 253.18,
    textures: {
      map: "/textures/neptune/map.jpg",
    },
  },
];
