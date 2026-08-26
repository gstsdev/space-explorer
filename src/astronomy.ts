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
// Tuned (in part) so Earth's own switchDistance (radiusKm / this) clears the
// Moon's ~384,400-420,000 km real orbital range (including its own
// eccentricity and the camera's offset when focused on the Moon itself) —
// at the previous 0.02, Earth degraded to a placeholder before the camera
// even reached the Moon, so the real Earth was never visible from there.
export const ANGULAR_THRESHOLD = 0.0125;

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
// without the base color map, and it keeps the loading code in
// Planet/TexturedSurface.tsx simple.
// Passed directly to drei's useTexture() (Planet/TexturedSurface.tsx), which
// treats every key here as an image URL to load — so nothing that isn't a
// real texture path belongs in this object. See PlanetData.surfaceTint for
// the exposure-compensation field this used to (wrongly) live inside here.
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
  // radius — true scale that's sub-pixel and invisible, so
  // Planet/Atmosphere.tsx exaggerates it (ATMOSPHERE_HEIGHT_EXAGGERATION) for
  // the rendered glow shell's thickness, the same problem placeholders solve
  // for whole-planet visibility at a distance.
  scaleHeightKm: number;
  // Real surface pressure relative to Earth's 101.325 kPa (Earth = 1) —
  // drives the glow's intensity in Planet/Atmosphere.tsx. Applied there via
  // sqrt and clamped (ATMOSPHERE_MIN_INTENSITY/MAX_INTENSITY): Venus's real 92x
  // would otherwise blow the glow out to solid white, and Mars's real
  // 0.0063x would otherwise be indistinguishable from nothing.
  relativeSurfacePressure: number;
  // Tint the Atmosphere shell shifts toward on the night side, as seen from
  // space (genuinely dark blue at ground level for Earth; this gray is a
  // conservative guess at how that reads without an atmosphere lit from
  // below by scattered ground/city light the way the real ground-level sky
  // is). Composition-dependent per atmosphere, not derived from
  // color/scaleHeightKm/relativeSurfacePressure above, and optional:
  // Planet/Atmosphere.tsx falls back to a muted default for any planet
  // without its own tuned value here, rather than asserting an unverified
  // color for atmospheres this hasn't been reasoned through for.
  nightColor?: string;
  // Tint for the sunset/twilight band along the terminator, rendered as a
  // surface-level color-tint term in TexturedSurface (see that component's
  // sunsetColor comment for why it lives on the surface rather than the
  // Atmosphere shell). Optional and only wired up for Earth so far.
  sunsetColor?: string;
};

// Unlike every other field in this file, deliberately NOT a real, dated
// snapshot of anything — Planet/Clouds.tsx generates a continuously
// morphing procedural cloud pattern (animated fractal noise) rather than
// sampling a real satellite cloud-cover texture. Real cloud cover has no
// orbital-mechanics-style closed form the way axial rotation or orbital
// position do (it's chaotic weather, not periodic motion), so there's no
// way to compute "the real clouds" at an arbitrary simulated date the way
// this file computes everything else — a real satellite photo would only
// ever be accurate for the one moment it was taken. This trades that
// real-but-frozen accuracy for a plausible-looking, never-repeating
// pattern instead. See Planet/Clouds.tsx's own comment for the rest.
export type PlanetCloudsData = {
  color: string;
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
  // Planet.tsx's polePositionWorld for how this converts into world space.
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
  // Multiplies the diffuse map before lighting (meshPhongMaterial's own
  // `color`, which is a plain per-channel multiply against `map`) — an
  // exposure compensation for light gray/white surfaces, not a color
  // choice. The Sun's pointLight (see Sun.tsx's own decay=1 comment) is
  // tuned so outer planets stay visible, which overexposes close-in ones by
  // tens of times; ACES tone mapping (this app's default) rolls that off
  // toward white rather than clipping, but a map whose pixels are already
  // light gray has so little headroom before saturating that the rolloff
  // reads as flat white with no surface detail — Mercury specifically (see
  // its own comment below). A duller-albedo map (Mars's red-orange,
  // Jupiter's bands) has more headroom before all channels clip together,
  // so it doesn't need this. Eyeballed against the running app, same as
  // this file's other empirically-fit constants. Deliberately a sibling of
  // textures, not a field inside it — that object is passed straight to
  // useTexture(), which treats every key as an image URL to load.
  surfaceTint?: string;
  ring?: PlanetRingData;
  atmosphere?: PlanetAtmosphereData;
  clouds?: PlanetCloudsData;
  // Real triaxial semi-axes (km), [equatorial-long, polar/spin-axis,
  // equatorial-short] — only for a body not close enough to round for the
  // sphere-based simplification every other body here uses (radiusKm's own
  // real oblateness is already ignored the same way for every planet, e.g.
  // Earth/Jupiter/Saturn — reasonable there since it's a similarly small
  // deviation; not reasonable for a body whose true shape is a genuine
  // triaxial ellipsoid, like Vesta). Applied in Planet.tsx as a non-uniform
  // scale on the mesh only — orbit position, placeholder LOD, and camera
  // focus distance all still use the single radiusKm mean-radius
  // approximation, same as every other approximation of that kind here.
  triaxialRadiiKm?: [number, number, number];
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
// The Moon's position is *not* modeled as a Kepler ellipse the way every
// planet above is — an earlier version of this file did that (fixed
// eccentricity/inclination plus epoch+rate secular precession for the node
// and argument of periapsis), and it's real but insufficient: real solar
// perturbation on the Moon's orbit also has large *periodic* components
// (evection ±1.27°, variation ±0.66°, the annual equation ±0.19°, and
// smaller ones) that a two-body ellipse can't represent at all, secular
// rates or not. That showed up as a concrete, checkable error — at a real
// solar eclipse (2026-08-12), this app's predicted conjunction time was off
// from the real one (per Wikipedia's own eclipse page) by about 7 hours,
// which traced back to the Moon's ecliptic longitude being off by ~3.5° at
// that instant, entirely explicable by those missing periodic terms.
//
// So instead, moonGeocentricEclipticPosition below computes the Moon's real
// geocentric ecliptic longitude/latitude/distance directly, via the
// standard truncated ELP2000-82B series (Jean Meeus, "Astronomical
// Algorithms," 2nd ed., Chapter 47) — ~10 arcsecond accuracy, several
// orders of magnitude better than this app needs, but it's the standard,
// well-verified algorithm real lunar ephemeris code actually uses, not a
// hand-truncated subset of it. MOON_LONGITUDE_DISTANCE_TERMS/
// MOON_LATITUDE_TERMS below are Meeus's own Tables 47.A/47.B verbatim
// (transcribed from, and cross-checked line-by-line against, the
// independently-maintained PyMeeus implementation — see moonGeocentricEclipticPosition's
// own comment for the exact source and the reference test case used to
// verify this port before it was wired in).
export type MoonData = {
  id: string;
  color: string;
  radiusKm: number;
  textures: {
    map: string;
    displacementMap?: string;
  };
  // See PlanetData.surfaceTint's own comment — same overexposure
  // compensation, needed here for the same reason (a light gray map lit by
  // the same close-in Sun light Earth's own TexturedSurface deals with).
  // Deliberately a sibling of textures, not a field inside it — see
  // PlanetTextures's own comment for why.
  surfaceTint?: string;
};

// Display-only reference constants (StatsPanel) — NOT used by the position
// calculation itself, which computes the Moon's real instantaneous
// longitude/latitude/distance directly rather than via fixed orbital
// elements (see MoonData's own comment). These are the standard
// long-term-average values quoted for the real orbit.
export const MOON_MEAN_DISTANCE_KM = 385_000.56; // the algorithm's own mean-distance constant
export const MOON_MEAN_ECCENTRICITY = 0.0549;
export const MOON_SIDEREAL_MONTH_DAYS = 27.321661;

// Table 47.A (Meeus): periodic terms for the Moon's longitude (Σl) and
// distance (Σr). Each row is [D, M, M′, F, coeffL, coeffR] — the first four
// are integer multipliers on the fundamental arguments (mean elongation D,
// Sun's mean anomaly M, Moon's mean anomaly M′, Moon's argument of latitude
// F) forming each term's sine/cosine argument; coeffL is in 1e-6 degree,
// coeffR in 1e-3 km. Terms whose M-multiplier is ±1 or ±2 get scaled by the
// Earth-orbit-eccentricity correction (E or E²) in
// moonGeocentricEclipticPosition, same as Meeus's own algorithm.
const MOON_LONGITUDE_DISTANCE_TERMS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [0, 0, 1, 0, 6288774.0, -20905355.0],
  [2, 0, -1, 0, 1274027.0, -3699111.0],
  [2, 0, 0, 0, 658314.0, -2955968.0],
  [0, 0, 2, 0, 213618.0, -569925.0],
  [0, 1, 0, 0, -185116.0, 48888.0],
  [0, 0, 0, 2, -114332.0, -3149.0],
  [2, 0, -2, 0, 58793.0, 246158.0],
  [2, -1, -1, 0, 57066.0, -152138.0],
  [2, 0, 1, 0, 53322.0, -170733.0],
  [2, -1, 0, 0, 45758.0, -204586.0],
  [0, 1, -1, 0, -40923.0, -129620.0],
  [1, 0, 0, 0, -34720.0, 108743.0],
  [0, 1, 1, 0, -30383.0, 104755.0],
  [2, 0, 0, -2, 15327.0, 10321.0],
  [0, 0, 1, 2, -12528.0, 0.0],
  [0, 0, 1, -2, 10980.0, 79661.0],
  [4, 0, -1, 0, 10675.0, -34782.0],
  [0, 0, 3, 0, 10034.0, -23210.0],
  [4, 0, -2, 0, 8548.0, -21636.0],
  [2, 1, -1, 0, -7888.0, 24208.0],
  [2, 1, 0, 0, -6766.0, 30824.0],
  [1, 0, -1, 0, -5163.0, -8379.0],
  [1, 1, 0, 0, 4987.0, -16675.0],
  [2, -1, 1, 0, 4036.0, -12831.0],
  [2, 0, 2, 0, 3994.0, -10445.0],
  [4, 0, 0, 0, 3861.0, -11650.0],
  [2, 0, -3, 0, 3665.0, 14403.0],
  [0, 1, -2, 0, -2689.0, -7003.0],
  [2, 0, -1, 2, -2602.0, 0.0],
  [2, -1, -2, 0, 2390.0, 10056.0],
  [1, 0, 1, 0, -2348.0, 6322.0],
  [2, -2, 0, 0, 2236.0, -9884.0],
  [0, 1, 2, 0, -2120.0, 5751.0],
  [0, 2, 0, 0, -2069.0, 0.0],
  [2, -2, -1, 0, 2048.0, -4950.0],
  [2, 0, 1, -2, -1773.0, 4130.0],
  [2, 0, 0, 2, -1595.0, 0.0],
  [4, -1, -1, 0, 1215.0, -3958.0],
  [0, 0, 2, 2, -1110.0, 0.0],
  [3, 0, -1, 0, -892.0, 3258.0],
  [2, 1, 1, 0, -810.0, 2616.0],
  [4, -1, -2, 0, 759.0, -1897.0],
  [0, 2, -1, 0, -713.0, -2117.0],
  [2, 2, -1, 0, -700.0, 2354.0],
  [2, 1, -2, 0, 691.0, 0.0],
  [2, -1, 0, -2, 596.0, 0.0],
  [4, 0, 1, 0, 549.0, -1423.0],
  [0, 0, 4, 0, 537.0, -1117.0],
  [4, -1, 0, 0, 520.0, -1571.0],
  [1, 0, -2, 0, -487.0, -1739.0],
  [2, 1, 0, -2, -399.0, 0.0],
  [0, 0, 2, -2, -381.0, -4421.0],
  [1, 1, 1, 0, 351.0, 0.0],
  [3, 0, -2, 0, -340.0, 0.0],
  [4, 0, -3, 0, 330.0, 0.0],
  [2, -1, 2, 0, 327.0, 0.0],
  [0, 2, 1, 0, -323.0, 1165.0],
  [1, 1, -1, 0, 299.0, 0.0],
  [2, 0, 3, 0, 294.0, 0.0],
  [2, 0, -1, -2, 0.0, 8752.0],
];

// Table 47.B (Meeus): periodic terms for the Moon's latitude (Σb). Each row
// is [D, M, M′, F, coeffB], coeffB in 1e-6 degree — same fundamental
// arguments and E/E² scaling rule as the longitude/distance table above.
const MOON_LATITUDE_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122.0],
  [0, 0, 1, 1, 280602.0],
  [0, 0, 1, -1, 277693.0],
  [2, 0, 0, -1, 173237.0],
  [2, 0, -1, 1, 55413.0],
  [2, 0, -1, -1, 46271.0],
  [2, 0, 0, 1, 32573.0],
  [0, 0, 2, 1, 17198.0],
  [2, 0, 1, -1, 9266.0],
  [0, 0, 2, -1, 8822.0],
  [2, -1, 0, -1, 8216.0],
  [2, 0, -2, -1, 4324.0],
  [2, 0, 1, 1, 4200.0],
  [2, 1, 0, -1, -3359.0],
  [2, -1, -1, 1, 2463.0],
  [2, -1, 0, 1, 2211.0],
  [2, -1, -1, -1, 2065.0],
  [0, 1, -1, -1, -1870.0],
  [4, 0, -1, -1, 1828.0],
  [0, 1, 0, 1, -1794.0],
  [0, 0, 0, 3, -1749.0],
  [0, 1, -1, 1, -1565.0],
  [1, 0, 0, 1, -1491.0],
  [0, 1, 1, 1, -1475.0],
  [0, 1, 1, -1, -1410.0],
  [0, 1, 0, -1, -1344.0],
  [1, 0, 0, -1, -1335.0],
  [0, 0, 3, 1, 1107.0],
  [4, 0, 0, -1, 1021.0],
  [4, 0, -1, 1, 833.0],
  [0, 0, 1, -3, 777.0],
  [4, 0, -2, 1, 671.0],
  [2, 0, 0, -3, 607.0],
  [2, 0, 2, -1, 596.0],
  [2, -1, 1, -1, 491.0],
  [2, 0, -2, 1, -451.0],
  [0, 0, 3, -1, 439.0],
  [2, 0, 2, 1, 422.0],
  [2, 0, -3, -1, 421.0],
  [2, 1, -1, 1, -366.0],
  [2, 1, 0, 1, -351.0],
  [4, 0, 0, 1, 331.0],
  [2, -1, 1, 1, 315.0],
  [2, -2, 0, -1, 302.0],
  [0, 0, 1, 3, -283.0],
  [2, 1, 1, -1, -229.0],
  [1, 1, 0, -1, 223.0],
  [1, 1, 0, 1, 223.0],
  [0, 1, -2, -1, -220.0],
  [2, 1, -1, -1, -220.0],
  [1, 0, 1, 1, -185.0],
  [2, -1, -2, -1, 181.0],
  [0, 1, 2, 1, -177.0],
  [4, 0, -2, -1, 176.0],
  [4, -1, -1, -1, 166.0],
  [1, 0, 1, -1, -164.0],
  [4, 0, 1, -1, 132.0],
  [1, 0, -1, -1, -119.0],
  [4, -1, 0, -1, 115.0],
  [2, -2, 0, 1, 107.0],
];

const DEG_TO_RAD = Math.PI / 180;

// Standard IAU general-precession-in-longitude rate (Meeus eq. 21.4,
// quadratic term dropped as negligible at this app's multi-decade
// timescale) — see moonGeocentricEclipticPosition's own comment for why
// this specifically is needed.
const GENERAL_PRECESSION_ARCSEC_PER_CENTURY = 5029.0966;

// Real geocentric ecliptic longitude/latitude/distance of the Moon, via
// Meeus's Chapter 47 algorithm — see MoonData's own comment for why this
// replaced a Kepler-ellipse model. Ported from, and checked line-by-line
// against, PyMeeus's implementation (github.com/architest/pymeeus,
// pymeeus/Moon.py — an independently-maintained, tested Python port of the
// same Meeus algorithm) rather than re-derived from the book by hand, to
// avoid the exact kind of transcription/derivation error that motivated
// this rewrite in the first place. Verified against PyMeeus's own docstring
// reference case (epoch 1992-04-12.0 TT → longitude 133.162655°, latitude
// -3.229126°, distance 368409.7 km) before being wired into this app;
// reproduced that case to within 4e-7° / 0.02 km, i.e. floating-point noise.
//
// One correction beyond the raw ported algorithm: Meeus's lunar theory
// inherently returns longitude referred to the mean equinox OF DATE — that's
// baked into its own fundamental-argument formulas, not a choice made here.
// Every other angle in this file (every planet's ascendingNodeDegrees,
// argumentOfPeriapsisDegrees, meanAnomalyAtEpochDegrees, ...) is instead
// pinned to a fixed J2000.0 frame, by deliberate design — see
// poleRaDegrees's own comment on dropping precession as negligible
// elsewhere. Left uncorrected, the two slowly diverge via general
// precession (~50.29"/year) — by 2026 (~26.6 years past J2000) that's
// already ~0.37°, and it was almost the *entire* remaining error in a real
// eclipse check: this app's computed Aug 12, 2026 solar eclipse conjunction
// was still ~44 minutes off the real one even with this same lunar theory
// in place. Independently cross-checking both the Sun's and Moon's
// longitude against real JPL Horizons ephemeris (not just each other)
// pinned that gap to this specific frame mismatch, not remaining
// imprecision in either body's own theory — subtracting the accumulated
// precession below brings both a real solar and a real lunar eclipse check
// down to within ~5 minutes.
//
// daysSinceEpoch is days since J2000.0 (TT vs this app's UTC approximation
// is the same negligible difference already accepted everywhere else in
// this file — see J2000_EPOCH_MS).
export function moonGeocentricEclipticPosition(daysSinceEpoch: number): {
  longitudeDegrees: number;
  latitudeDegrees: number;
  distanceKm: number;
} {
  const t = daysSinceEpoch / 36525; // Julian centuries since J2000.0

  // Fundamental arguments, degrees (Meeus 47.1-47.5).
  const meanLongitude =
    218.3164477 + (481267.88123421 + (-0.0015786 + (1 / 538841 - t / 65194000) * t) * t) * t;
  const meanElongation =
    297.8501921 + (445267.1114034 + (-0.0018819 + (1 / 545868 - t / 113065000) * t) * t) * t;
  const sunMeanAnomaly = 357.5291092 + (35999.0502909 + (-0.0001536 + t / 24490000) * t) * t;
  const moonMeanAnomaly =
    134.9633964 + (477198.8675055 + (0.0087414 + (1 / 69699 - t / 14712000) * t) * t) * t;
  const argumentOfLatitude =
    93.272095 + (483202.0175233 + (-0.0036539 + (-1 / 3526000 + t / 863310000) * t) * t) * t;
  // Additional arguments (Venus/Jupiter perturbations and a flattening
  // correction) that the additive terms below need directly.
  const a1 = 119.75 + 131.849 * t;
  const a2 = 53.09 + 479264.29 * t;
  const a3 = 313.45 + 481266.484 * t;
  // Corrects the M-dependent terms for the slow real change in Earth's own
  // orbital eccentricity since these tables were fit.
  const e = 1 + (-0.002516 - 0.0000074 * t) * t;
  const e2 = e * e;

  const dRad = meanElongation * DEG_TO_RAD;
  const mRad = sunMeanAnomaly * DEG_TO_RAD;
  const mPrimeRad = moonMeanAnomaly * DEG_TO_RAD;
  const fRad = argumentOfLatitude * DEG_TO_RAD;
  const lPrimeRad = meanLongitude * DEG_TO_RAD;
  const a1Rad = a1 * DEG_TO_RAD;
  const a2Rad = a2 * DEG_TO_RAD;
  const a3Rad = a3 * DEG_TO_RAD;
  const args = [dRad, mRad, mPrimeRad, fRad];

  let sigmaL = 0;
  let sigmaR = 0;
  for (const [dMult, mMult, mPrimeMult, fMult, coeffL, coeffR] of MOON_LONGITUDE_DISTANCE_TERMS) {
    const argument = dMult * args[0] + mMult * args[1] + mPrimeMult * args[2] + fMult * args[3];
    const eScale = Math.abs(mMult) === 1 ? e : Math.abs(mMult) === 2 ? e2 : 1;
    sigmaL += coeffL * eScale * Math.sin(argument);
    sigmaR += coeffR * eScale * Math.cos(argument);
  }
  sigmaL += 3958 * Math.sin(a1Rad) + 1962 * Math.sin(lPrimeRad - fRad) + 318 * Math.sin(a2Rad);

  let sigmaB = 0;
  for (const [dMult, mMult, mPrimeMult, fMult, coeffB] of MOON_LATITUDE_TERMS) {
    const argument = dMult * args[0] + mMult * args[1] + mPrimeMult * args[2] + fMult * args[3];
    const eScale = Math.abs(mMult) === 1 ? e : Math.abs(mMult) === 2 ? e2 : 1;
    sigmaB += coeffB * eScale * Math.sin(argument);
  }
  sigmaB +=
    -2235 * Math.sin(lPrimeRad) +
    382 * Math.sin(a3Rad) +
    175 * Math.sin(a1Rad - fRad) +
    175 * Math.sin(a1Rad + fRad) +
    127 * Math.sin(lPrimeRad - mPrimeRad) -
    115 * Math.sin(lPrimeRad + mPrimeRad);

  // Converts Meeus's inherent equinox-of-date longitude into this app's
  // fixed-J2000 frame — see this function's own comment above.
  const precessionCorrectionDegrees = (GENERAL_PRECESSION_ARCSEC_PER_CENTURY * t) / 3600;
  const rawLongitudeDegrees = meanLongitude + sigmaL / 1_000_000 - precessionCorrectionDegrees;
  const longitudeDegrees = ((rawLongitudeDegrees % 360) + 360) % 360;
  const latitudeDegrees = sigmaB / 1_000_000;
  const distanceKm = MOON_MEAN_DISTANCE_KM + sigmaR / 1000;
  return { longitudeDegrees, latitudeDegrees, distanceKm };
}

// Real lunar topography spans roughly ±10 km from the mean radius (deepest
// basin to highest peak, ~20 km total relief). Unlike the atmosphere
// shell's deliberately exaggerated height (ATMOSPHERE_HEIGHT_EXAGGERATION),
// this is applied at true scale via displacementMap/displacementScale in
// Moon/MoonSurface.tsx: real lunar relief is coarse enough to read even at
// true scale once close enough to see the mesh at all. The sourced
// displacement texture's own black/white-to-km calibration isn't
// independently verified against real elevation data, so this is a
// reasonable real-magnitude approximation, not a precisely calibrated one.
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
    // Closest planet to the Sun's pointLight — the most overexposed body in
    // the scene (see PlanetData.surfaceTint's own comment).
    surfaceTint: "#4d4d4d",
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
    // Roughly Earth's own distance from the Sun's pointLight (so a similar
    // ~20-30x overexposure — see PlanetData.surfaceTint's own comment), and
    // real Venus's sulfuric-acid cloud tops are a pale cream/white with
    // about as little exposure headroom as Mercury's or the Moon's map.
    surfaceTint: "#6b6b6b",
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
    // Planet.tsx's axialTiltRadians was also negated (a separate, sibling fix,
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
      // See PlanetAtmosphereData.sunsetColor's comment. A real sunset-orange
      // as photographed from orbit, not tuned/verified beyond "looks like
      // reference photos."
      sunsetColor: "#c68566",
    },
    // See PlanetCloudsData's own comment — procedural, not real.
    clouds: {
      color: "#ffffff",
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
  // Ceres and Vesta: real, individually-tracked main-belt bodies (not the
  // procedural point-cloud stand-in in AsteroidBelt.tsx, which represents
  // the ~1.2 million other, uncataloged asteroids) — added to PLANETS
  // rather than a separate array since they follow the exact same
  // two-body Keplerian model and every consumer of this array (Scene.tsx,
  // StatsPanel.tsx) already works generically over anything in it.
  //
  // Orbital elements (eccentricity through meanAnomalyAtEpochDegrees) for
  // both are real heliocentric osculating elements queried directly from
  // JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api) at epoch
  // 2451545.0 (J2000.0, TDB) — the same epoch/frame convention
  // (J2000_EPOCH_MS, "Ecliptic of J2000.0") this app already uses for
  // every planet above, so no conversion beyond unit copying.
  {
    id: "ceres",
    // Real: dark, grayish-brown (C-type/G-type composition, low albedo
    // ~0.09 — similar reflectivity to asphalt).
    color: "#6b645c",
    radiusKm: 469.7,
    semiMajorAxisKm: 413_861_913.9,
    eccentricity: 0.078376,
    // 9.07417h (Horizons ROTPER) — independently cross-checked against the
    // Dawn mission's own final PM rotation rate below (952.1532635°/day →
    // 360/952.1532635 = 9.0742h): matches to 4 significant figures.
    rotationPeriodDays: 0.378090,
    // Real, final Dawn-mission determination (dawn_ceres_v06.tpc, the
    // authoritative post-mission SPICE kernel, Dec 2018) — matches the
    // independently-published Ermakov et al. 2017 (Icarus) value closely.
    // Note: the older "generic" pck00011.tpc kernel's Ceres entry
    // (RA=70.14, Dec=39.48) predates Dawn's 2015 Ceres arrival and is
    // stale — its own PM rotation rate doesn't even match Horizons'
    // ROTPER (implies ~5.83h, not the real ~9.07h), confirming it
    // shouldn't be used here even though it's the same kernel file this
    // app's planets above cite.
    poleRaDegrees: 291.42763,
    poleDecDegrees: 66.76033,
    inclinationDegrees: 10.58336,
    ascendingNodeDegrees: 80.494357,
    argumentOfPeriapsisDegrees: 73.922863,
    meanAnomalyAtEpochDegrees: 6.176655,
    // Calibrated against real JPL Horizons sub-solar longitude (raw
    // Dawn-mission PM W0 is 170.309) — matches within ~0.0001° at the
    // reference date (2026-08-26 20:31 UTC), but grows to ~5.8° at a
    // second test date 81 days later (2026-11-15), a larger residual than
    // most planets here — plausibly real: Ceres, like every asteroid-belt
    // body, is more perturbed by Jupiter's proximity than this app's
    // simple 2-body ellipse accounts for, in the same direction (if a
    // larger magnitude) as Uranus's own ~6-8° residual below.
    rotationAtEpochDegrees: 345.139,
    textures: {
      map: "/textures/ceres/map.jpg"
    }
  },
  {
    id: "vesta",
    // Real: notably bright for an asteroid (V-type, albedo ~0.42 vs.
    // Ceres' ~0.09), brownish-gray.
    color: "#a89a84",
    radiusKm: 261.385,
    // Real triaxial semi-axes (km), from the Dawn mission's final gravity
    // model (dawn_vesta_grv221108_v1.tpc, 2025) — genuinely non-spherical
    // (a 20%+ difference between longest and shortest axis), unlike every
    // other body in this file — see PlanetData.triaxialRadiiKm's own
    // comment for how this is applied. Order matches that field's own
    // [equatorial-long, polar/spin-axis, equatorial-short] convention;
    // the exact azimuthal alignment of the two equatorial axes relative to
    // the real surface (as opposed to just their lengths) isn't verified
    // here, since rotationAtEpochDegrees below is also still a raw,
    // uncalibrated value.
    triaxialRadiiKm: [284.62, 226.33, 277.24],
    semiMajorAxisKm: 353_280_597.8,
    eccentricity: 0.090022,
    // 5.342128h (Horizons ROTPER) — independently cross-checked against
    // the Dawn mission's own final PM rotation rate below
    // (1617.333129223909°/day → 360/1617.333129223909 = 5.3421h): matches
    // to 5 significant figures.
    rotationPeriodDays: 0.222589,
    // Real, final Dawn-mission gravity-model determination
    // (dawn_vesta_grv221108_v1.tpc, 2025) — closely matches the older
    // dawn-derived pck00011.tpc value (309.031, 42.235), unlike Ceres'
    // own stale generic-kernel entry (see Ceres' own comment above).
    poleRaDegrees: 309.061095,
    poleDecDegrees: 42.232386,
    inclinationDegrees: 7.133936,
    ascendingNodeDegrees: 103.951437,
    argumentOfPeriapsisDegrees: 149.586668,
    meanAnomalyAtEpochDegrees: 341.023834,
    // Calibrated against real JPL Horizons sub-solar longitude (raw
    // Dawn-mission PM W0 is 284.643098) — matches within ~0.0001° at the
    // reference date (2026-08-26 20:31 UTC) and holds up well at a second
    // test date 81 days later (~0.45° residual, 2026-11-15).
    rotationAtEpochDegrees: 147.947,
    textures: {
      map: "/textures/vesta/map.png"
    }
  },
];

// Real value: radiusKm is the IAU-adopted mean lunar radius. Position comes
// from moonGeocentricEclipticPosition above, not from any element stored
// here — see MoonData's own comment.
export const EARTH_MOON_DATA: MoonData = {
  id: "moon",
  color: "#bfbfbf",
  radiusKm: 1737.4,
  textures: {
    map: "/textures/earth/moon/map.jpg",
    displacementMap: "/textures/earth/moon/displacement.jpg",
  },
  // Same distance from the Sun as Earth, so the same overexposure — see
  // PlanetData.surfaceTint's own comment.
  surfaceTint: "#b0b0b0",
};

export type AsteroidBeltData = {
  color: string;
  innerRadiusKm: number;
  outerRadiusKm: number;
};

// Real: the radial extent is a commonly-cited round figure (~2.1-3.3 AU),
// roughly the 4:1/2:1 Jupiter mean-motion (Kirkwood-gap) resonances that
// bound the bulk of the real population — Ceres, the belt's largest body,
// sits at a real 2.77 AU, close to this range's own 2.7 AU midpoint, a
// reasonable sanity check. AsteroidBelt.tsx's per-particle rotation (inner
// edge visibly outpacing the outer edge) is driven by the same real
// Kepler's-third-law constant (GM_SUN_KM3_S2 above) every planet's own
// period already uses, and its per-particle sun-relative shading (see that
// file's own comment) is real too, in that it responds to the sun's actual
// position rather than being a fixed lit/dark split.
// color is a rough average for the belt's most common composition (~75%
// C-type/carbonaceous: dark, grayish-brown, low albedo ~0.03-0.09, similar
// to asphalt) rather than the lighter, redder S-type (~17%, concentrated
// closer to Mars) this used to be tuned toward — not a per-particle
// spectral-type split (real asteroids vary considerably; this is one
// averaged color for the whole belt).
// Stylized beyond the color: rendered as a point cloud (AsteroidBelt.tsx)
// standing in for ~1.2 million real cataloged asteroids' actual positions
// — same "no practical closed form for this many individual bodies"
// reasoning as PlanetCloudsData's own comment, just because of data volume
// here rather than chaos — with real vertical/inclination scatter
// approximated (see that file's BELT_HALF_THICKNESS_AU) rather than
// reproducing a real inclination distribution. The belt's overall
// visibility itself is also an exaggeration: real asteroids are sparse and
// dim enough that the actual belt looks like empty space in every real
// spacecraft photo — this is a legibility choice, the same kind this app
// already makes for placeholders (PLACEHOLDER_SIZE) and atmosphere glow
// shells (ATMOSPHERE_HEIGHT_EXAGGERATION), not a claim about real density.
export const MAIN_BELT_DATA: AsteroidBeltData = {
  color: "#6e6860",
  innerRadiusKm: 2.1 * KM_PER_AU,
  outerRadiusKm: 3.3 * KM_PER_AU,
};
