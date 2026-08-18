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

export type PlanetAtmosphereData = {
  // Real Rayleigh/aerosol scattering color as seen in real limb photos —
  // independent of the two values below, which shape the glow rather than
  // color it (Earth's blue, Venus's pale yellow haze, Mars's dusty tan).
  color: string;
  // Real atmospheric scale height in km (how fast pressure/density falls
  // off with altitude). Every value here is under 0.3% of its own planet's
  // radius — true scale that's sub-pixel and invisible, so Scene.tsx
  // exaggerates it (ATMOSPHERE_HEIGHT_EXAGGERATION) for the rendered glow
  // shell's thickness, the same problem placeholders solve for whole-planet
  // visibility at a distance.
  scaleHeightKm: number;
  // Real surface pressure relative to Earth's 101.325 kPa (Earth = 1) —
  // drives the glow's intensity in Scene.tsx. Applied there via sqrt and
  // clamped (ATMOSPHERE_MIN_INTENSITY/MAX_INTENSITY): Venus's real 92x
  // would otherwise blow the glow out to solid white, and Mars's real
  // 0.0063x would otherwise be indistinguishable from nothing.
  relativeSurfacePressure: number;
  // Tint the Atmosphere shell shifts toward on the night side, as seen from
  // space (genuinely dark blue at ground level for Earth; this gray is a
  // conservative guess at how that reads without an atmosphere lit from
  // below by scattered ground/city light the way the real ground-level sky
  // is). Composition-dependent per atmosphere, not derived from
  // color/scaleHeightKm/relativeSurfacePressure above, and optional:
  // Scene.tsx falls back to a muted default for any planet without its own
  // tuned value here, rather than asserting an unverified color for
  // atmospheres this hasn't been reasoned through for.
  nightColor?: string;
};

export type PlanetData = {
  id: string;
  color: string;
  radiusKm: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  rotationPeriodDays: number;
  // Real obliquity magnitude — display only (StatsPanel). NOT used to
  // orient the 3D mesh: a single tilt angle can only describe a rotation
  // about one fixed axis, which is only physically correct for Earth (see
  // poleRaDegrees/poleDecDegrees below for what actually drives rendering).
  axialTiltDegrees?: number;
  // Real north pole orientation at J2000.0, as right ascension/declination
  // in the equatorial (ICRF) frame — the IAU/IAG WGCCRE rotational-elements
  // convention (values from the SPICE pck00011.tpc kernel's POLE_RA/
  // POLE_DEC constant terms; the small per-century precession coefficients
  // are dropped as negligible next to this app's other approximations).
  // This is what actually orients each planet's mesh: axialTiltDegrees
  // alone (a single rotation about world +X) only happens to be correct
  // for Earth, because Earth's own equator defines the reference frame
  // these RA/Dec values are measured against (ascendingNodeDegrees=0) — see
  // Scene.tsx's polePositionWorld for how this converts into world space.
  // IAU convention always lists the pole on the invariable-plane-north
  // side regardless of spin direction (unlike the axialTiltDegrees-based
  // "flip past 90° for retrograde" convention above) — do not flip this
  // pole for Venus/Uranus. Fixes sub-solar *latitude* for every planet,
  // verified against real JPL Horizons data (previously wrong for all 7
  // non-Earth planets — e.g. Uranus computed −61° against a real +73°).
  // Longitude still uses each planet's existing rotationAtEpochDegrees
  // (real IAU W0) unadjusted; unlike Earth's, these haven't been
  // individually empirically recalibrated against Horizons, so sub-solar
  // longitude for non-Earth planets, while now driven by the right pole
  // axis, isn't verified to the same precision as latitude.
  poleRaDegrees?: number;
  poleDecDegrees?: number;
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
  // Prime-meridian rotation angle at the J2000.0 epoch, in degrees — the
  // axial-spin counterpart to meanAnomalyAtEpochDegrees. Every planet here
  // except Venus is empirically fit against real JPL Horizons sub-solar
  // longitude (not the raw IAU W0), since this app's specific texture UV/
  // handedness/tilt setup leaves a small but *stable* residual offset from
  // the textbook value — same story as argumentOfPeriapsisDegrees above,
  // just for longitude instead of orbital shape. Each planet's own comment
  // has the numbers. Venus is the one exception: real JPL data shows its
  // sub-solar longitude drifting against this app's model at a small but
  // real, so-far-unexplained rate (~3°/day) that a one-time constant can't
  // fix, so it's left at the raw IAU W0 rather than a calibration that
  // would only be accurate near whatever date it was fit to.
  rotationAtEpochDegrees?: number;
  textures?: PlanetTextures;
  ring?: PlanetRingData;
  atmosphere?: PlanetAtmosphereData;
};

// See PlanetAtmosphereData.scaleHeightKm's comment for why this exists.
export const ATMOSPHERE_HEIGHT_EXAGGERATION = 12;

// See PlanetAtmosphereData.relativeSurfacePressure's comment for why this
// range (rather than the raw pressure ratio) drives glow intensity.
export const ATMOSPHERE_MIN_INTENSITY = 0.35;
export const ATMOSPHERE_MAX_INTENSITY = 1.5;

// Deliberately scoped to Earth's Moon specifically, not a general "any body
// can orbit any other body" moons system — there's exactly one real case to
// support right now, and its own modeling needs (see below) are different
// enough from a planet's that a shared abstraction would mean more
// branching than the duplication it'd save. Worth revisiting if/when a
// second moon shows up and shows what's actually common between two real
// cases, rather than guessing now.
//
// The Moon's real orbit is geocentric (around Earth, not the sun) and,
// unlike every planet's orbit above, its ascending node and argument of
// periapsis aren't approximately fixed over human timescales: solar
// perturbation regresses the node on an 18.6-year cycle and precesses the
// perigee on an 8.85-year cycle, both fast enough that this app's real-time
// clock (seeded from *today*, decades past J2000.0) would show a visibly
// wrong orbital plane without modeling them. So unlike PlanetData's fixed
// inclinationDegrees/ascendingNodeDegrees/argumentOfPeriapsisDegrees, this
// carries an epoch value *and* a real secular rate (degrees/day) for each of
// those two elements, evaluated the same "epoch + rate × time" way
// PlanetData.rotationAtEpochDegrees already is for spin (see Scene.tsx's
// Moon component). Real periodic perturbation terms on top of that secular
// drift (evection, variation, the annual equation — collectively why the
// real Moon's osculating elements wobble around these mean values on
// ~week/month timescales) aren't modeled; expect roughly the same order of
// position error as this app's least-precise planet (Uranus, ~6-8°).
export type MoonData = {
  id: string;
  color: string;
  radiusKm: number;
  // Real osculating (i.e. exact instantaneous, not long-term-averaged)
  // Earth-Moon distance-defining semi-major axis at J2000.0 — from JPL
  // Horizons (geocentric, ecliptic-of-J2000 frame), for self-consistency
  // with the other osculating elements below (all from the same query, same
  // instant). The commonly-quoted "384,400 km" is the long-term mean; the
  // real distance oscillates around it by roughly this much due to monthly
  // solar perturbation (evection/variation), which this app doesn't model.
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDegrees: number;
  ascendingNodeAtEpochDegrees: number;
  ascendingNodeRatePerDay: number;
  argumentOfPeriapsisAtEpochDegrees: number;
  argumentOfPeriapsisRatePerDay: number;
  meanAnomalyAtEpochDegrees: number;
  // The real anomalistic mean motion — close to, but deliberately not
  // taken directly from, the textbook 360°/27.554550-day anomalistic
  // month (see EARTH_MOON_DATA's own comment for why a same-shaped error
  // in argumentOfPeriapsisRatePerDay made "textbook period taken at face
  // value" untrustworthy enough here to refit empirically instead).
  // Deliberately *not* derived from a GM constant and semiMajorAxisKm via
  // Kepler's third law the way every PlanetData's period is (see
  // orbitalPeriodDays), either: that would need the *system's* combined
  // mass (GM_EARTH + GM_MOON, not GM_EARTH alone) just to land on the
  // right month length, and even then would only reproduce the orbit's
  // unperturbed two-body rate, not the real (perturbed) one this rate
  // reflects.
  meanAnomalyRatePerDay: number;
  textures: {
    map: string;
    displacementMap?: string;
  };
};

// Real lunar topography spans roughly ±10 km from the mean radius (deepest
// basin to highest peak, ~20 km total relief). Unlike the atmosphere
// shell's deliberately exaggerated height (ATMOSPHERE_HEIGHT_EXAGGERATION),
// this is applied at true scale via displacementMap/displacementScale in
// Scene.tsx: real lunar relief is coarse enough to read even at true scale
// once close enough to see the mesh at all. The sourced displacement
// texture's own black/white-to-km calibration isn't independently verified
// against real elevation data, so this is a reasonable real-magnitude
// approximation, not a precisely calibrated one.
export const MOON_RELIEF_KM = 20;

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
    poleRaDegrees: 281.0103,
    poleDecDegrees: 61.4155,
    inclinationDegrees: 7.005,
    ascendingNodeDegrees: 48.331,
    argumentOfPeriapsisDegrees: 29.127,
    meanAnomalyAtEpochDegrees: 174.796,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 329.5988) — matches within ~0.1° across dates spanning a year.
    rotationAtEpochDegrees: 249.495,
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
    poleRaDegrees: 272.76,
    poleDecDegrees: 67.16,
    inclinationDegrees: 3.39458,
    ascendingNodeDegrees: 76.68,
    argumentOfPeriapsisDegrees: 54.923,
    meanAnomalyAtEpochDegrees: 50.377,
    // Raw IAU W0, NOT calibrated — see rotationAtEpochDegrees's comment
    // above. Real sub-solar longitude drifts against this app's model at a
    // rate that returns to the same value every Venus year (224.7 days,
    // checked directly — not a runaway drift), so it's a real periodic
    // effect, not noise. Latitude is unaffected and matches real data to
    // ~0.003°, and both suspects that would normally explain a periodic
    // longitude-only error are individually ruled out: this app's 2-body
    // orbital position matches JPL's real (perturbed) position within
    // ~0.1° with no periodic component, and the tilt+spin quaternion math
    // is algebraically the correct representation of constant-rate rigid
    // rotation about a fixed pole. Root cause not yet found — tracked in
    // issue #2, which also has the debugging approach that would find it
    // (compare intermediate quantities against Horizons directly, not just
    // the final longitude).
    rotationAtEpochDegrees: 160.2,
    textures: {
      map: "/textures/venus/map.jpg",
    },
    // Real: dense CO2 atmosphere under a global sulfuric-acid haze, ~92x
    // Earth's surface pressure — the thickest, brightest glow of the three
    // atmospheres modeled here.
    atmosphere: {
      color: "#e8d3a0",
      scaleHeightKm: 15.9,
      relativeSurfacePressure: 92,
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
    poleRaDegrees: 0,
    poleDecDegrees: 90,
    // Earth's ascendingNodeDegrees is 0 (it defines the reference plane), so
    // this is the full angle from perihelion to the vernal equinox — see
    // PlanetData.argumentOfPeriapsisDegrees; this is the one value in this
    // file directly verified against real JPL sub-solar-point data.
    argumentOfPeriapsisDegrees: 102.938,
    meanAnomalyAtEpochDegrees: 357.527,
    // Empirically calibrated against real JPL data (not the raw IAU W0 of
    // 190.147°) — see tiltOrbitalPosition's comment for why. Longitude alone
    // came out a stable ~91.77° off across a full year of test dates until
    // Scene.tsx's axialTiltRadians was also negated (a separate, sibling fix,
    // not something to redo here); with both fixes in place, this value gives
    // real sub-solar longitude AND latitude matches within ~0.2° across five
    // dates spanning a full year.
    rotationAtEpochDegrees: 98.377,
    textures: {
      map: "/textures/earth/map.jpg",
      normalMap: "/textures/earth/normal.png",
      specularMap: "/textures/earth/specular.png",
      nightMap: "/textures/earth/nightmap.jpg",
    },
    // Real: nitrogen/oxygen atmosphere at 1 standard atmosphere — the
    // reference point relativeSurfacePressure is scaled against.
    atmosphere: {
      color: "#7ec8ff",
      scaleHeightKm: 8.5,
      relativeSurfacePressure: 1,
      nightColor: "#5d7c9a",
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
    poleRaDegrees: 317.269202,
    poleDecDegrees: 54.432516,
    inclinationDegrees: 1.85,
    ascendingNodeDegrees: 49.558,
    argumentOfPeriapsisDegrees: 286.497,
    meanAnomalyAtEpochDegrees: 19.39,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 176.049863) — matches within ~0.6° across dates spanning a year.
    rotationAtEpochDegrees: 126.657,
    textures: {
      map: "/textures/mars/map.jpg",
    },
    // Real: thin CO2 atmosphere, ~0.63% of Earth's surface pressure — the
    // faintest of the three glows modeled here (clamped up to
    // ATMOSPHERE_MIN_INTENSITY so it's still visible rather than nothing).
    atmosphere: {
      color: "#d99a6c",
      scaleHeightKm: 11.1,
      relativeSurfacePressure: 0.0063,
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
    poleRaDegrees: 268.056595,
    poleDecDegrees: 64.495303,
    inclinationDegrees: 1.303,
    ascendingNodeDegrees: 100.464,
    argumentOfPeriapsisDegrees: 274.255,
    meanAnomalyAtEpochDegrees: 19.668,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 284.95) — matches within ~0.4° across dates spanning a year.
    rotationAtEpochDegrees: 201.038,
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
    poleRaDegrees: 40.589,
    poleDecDegrees: 83.537,
    inclinationDegrees: 2.485,
    ascendingNodeDegrees: 113.665,
    argumentOfPeriapsisDegrees: 338.936,
    meanAnomalyAtEpochDegrees: 317.355,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 38.9) — matches within ~0.5° across dates spanning a year.
    rotationAtEpochDegrees: 46.054,
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
    poleRaDegrees: 257.311,
    poleDecDegrees: -15.175,
    inclinationDegrees: 0.773,
    ascendingNodeDegrees: 74.006,
    argumentOfPeriapsisDegrees: 96.937,
    meanAnomalyAtEpochDegrees: 142.284,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 203.81) — the least precise of this app's calibrated planets,
    // within ~6° across dates spanning a year (vs ~0.5° for the others);
    // Uranus's near-90° tilt combined with its fast (~17h) spin may be
    // amplifying this app's two-body orbital-position approximation error
    // more than for other planets. Still a large improvement over the raw
    // (uncalibrated) IAU value.
    rotationAtEpochDegrees: 21.146,
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
    // The commonly-quoted 0.67125 (16.11h) doesn't match the IAU-adopted
    // rotation rate its own W0/Wdot below are defined against (541.1397757
    // °/day → 0.665262d/15.97h); that 0.9% mismatch compounded into a real,
    // clearly measurable sub-solar-longitude drift (~4.9°/day) against real
    // JPL Horizons data once the tilt fix below made longitude otherwise
    // trustworthy enough to notice it. Using the self-consistent value.
    rotationPeriodDays: 0.665262,
    axialTiltDegrees: 28.32,
    poleRaDegrees: 299.36,
    poleDecDegrees: 43.46,
    inclinationDegrees: 1.77,
    ascendingNodeDegrees: 131.784,
    argumentOfPeriapsisDegrees: 273.181,
    meanAnomalyAtEpochDegrees: 259.915,
    // Calibrated against real JPL Horizons sub-solar longitude (raw IAU W0
    // is 249.978) — matches within ~0.1° across dates spanning a year.
    rotationAtEpochDegrees: 87.065,
    textures: {
      map: "/textures/neptune/map.jpg",
    },
  },
];

// Real values: radiusKm is the IAU-adopted mean lunar radius. Orbital
// elements are JPL Horizons osculating elements at 2000-Jan-01 12:00 TDB
// (COMMAND=301, CENTER=500@399, ecliptic-of-J2000 frame) — the same epoch
// every PlanetData element above is anchored to.
//
// The three rates below are *not* the commonly-quoted textbook precession
// periods (18.5996yr nodal, 8.8504yr apsidal, 27.554550-day anomalistic
// month) applied directly — an earlier version of this data did that, and
// it's wrong in a way that only shows up decades from J2000.0: the
// "8.8504yr" figure is how fast the *longitude* of periapsis (Ω + ω,
// measured in a space-fixed sense) precesses, not the argument of
// periapsis ω alone — ω is measured from the ascending node, which is
// itself regressing, so dω/dt is actually (longitude-of-periapsis rate) −
// (node rate) ≈ 0.1114 − (−0.0530) ≈ 0.1644°/day, roughly 50% faster than
// 0.1114°/day alone. That error compounds linearly with time; by 26+ years
// past J2000.0 (this app's own "today" default — see secondsSinceJ2000)
// it put the Moon's argument of periapsis nearly 190° off from real
// Horizons data, i.e. roughly the wrong side of its orbit.
//
// Rather than re-derive the "correct" textbook rate by hand and risk the
// same class of error again, these three rates are fit directly from real
// JPL Horizons osculating elements at three dates spanning 2000-01-01
// through today (2000-01-01 12:00 TDB, 2010-01-01 00:00 TDB, and
// 2026-08-18 00:00 TDB) — (laterValue − earlierValue) / daysBetween, with
// the number of full ±360° revolutions between samples resolved by
// comparison against the textbook-period estimate (close enough over
// these gaps to be unambiguous). This is real, empirically-fit secular
// drift, correct at both ends of that 26-year span by construction; it
// still doesn't capture the periodic (sub-cycle) perturbation wobble
// real osculating elements have on top of the secular trend, which showed
// up as a few degrees of residual at the 2010 midpoint when checked —
// comparable to this app's least-precise planet (Uranus, ~6-8°).
export const EARTH_MOON_DATA: MoonData = {
  id: "moon",
  color: "#bfbfbf",
  radiusKm: 1737.4,
  semiMajorAxisKm: 381_874.5,
  eccentricity: 0.063147,
  inclinationDegrees: 5.240273,
  ascendingNodeAtEpochDegrees: 123.958055,
  ascendingNodeRatePerDay: -0.052913,
  argumentOfPeriapsisAtEpochDegrees: 308.922673,
  argumentOfPeriapsisRatePerDay: 0.165551,
  meanAnomalyAtEpochDegrees: 146.673275,
  meanAnomalyRatePerDay: 13.063776,
  textures: {
    map: "/textures/earth/moon/map.jpg",
    displacementMap: "/textures/earth/moon/displacement.jpg",
  },
};
