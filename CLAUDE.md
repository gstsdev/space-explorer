# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build (`vite build`)
- `npm run lint` — ESLint over the whole project
- `npm run preview` — serve the production build locally

There is no test suite/framework in this project. Verification is `tsc -b --noEmit` + `npm run lint` passing, plus manually checking behavior in the running dev server — and for anything touching orbital mechanics, cross-checking against real ephemeris data (see below).

## What this is

A real-scale, physically-accurate solar system explorer (React Three Fiber / Three.js / TypeScript / Vite). Sizes, distances, orbital periods, orbital shapes, and axial orientation are true-to-scale/real (1 scene unit = 1,000,000 km, see `KM_TO_UNITS` in `src/astronomy.ts`) rather than artistically exaggerated. Orbits are simulated as independent two-body Keplerian ellipses (not N-body gravity) — each planet orbits a fixed sun, with no planet-planet interaction.

## Architecture

### The simulation clock is a plain mutable object, not React state

`src/simulation.ts` exports `simulation`, a plain `{ time, speed }` object mutated directly (`simulation.time += delta * simulation.speed`), read by every orbiting body every frame. This is deliberate: routing it through React state/context would re-render the whole scene tree every frame just to advance a number, and mutating a ref/context value directly trips the `react-hooks/immutability` ESLint rule. `simulation.time` is seconds since the J2000.0 epoch (seeded from `secondsSinceJ2000()` on load, so the app opens with every planet at its real current position) — the playback speed slider (`SpeedControl.tsx`) just multiplies how fast it advances.

### `useFrame` ordering is an explicit pipeline (`src/framePriority.ts`)

R3F runs `useFrame` subscribers in ascending priority order each tick. `FRAME_PRIORITY` turns the frame into explicit stages: `advanceTime` (-30) → `updatePosition` (-20) → `updateCamera` (-10) → `updateVisibility` (0). This ordering matters concretely: a planet's LOD (mesh vs. placeholder) check must run *after* the camera has caught up to that planet's *new* position, or the check compares against a stale camera position — invisible at low playback speed, but visibly wrong at high speed. **All priorities must stay ≤ 0** — R3F treats any positive priority as opt-in to manual rendering (it stops auto-calling `gl.render`).

### Orbital mechanics data model (`src/astronomy.ts`)

`PLANETS: PlanetData[]` holds real astronomical elements per planet, all referenced to the J2000.0 epoch:
- `semiMajorAxisKm`, `eccentricity` — orbit shape.
- `inclinationDegrees`, `ascendingNodeDegrees` — orbital plane's 3D tilt relative to the ecliptic.
- `argumentOfPeriapsisDegrees` — angle from the ascending node to perihelion (real orbits don't have perihelion sitting at the node).
- `meanAnomalyAtEpochDegrees` — real orbital phase at J2000.0, so the sim doesn't start every planet at perihelion.
- `poleRaDegrees`/`poleDecDegrees` — real north pole orientation at J2000.0 (right ascension/declination, IAU/IAG rotational-elements convention). This is what actually orients each planet's mesh in 3D — see `polePositionWorld()` in `src/Planet.tsx`.
- `axialTiltDegrees` — obliquity magnitude only, for display (`StatsPanel`); **not** used to orient the mesh (a single fixed-axis rotation can only be physically correct for a planet whose `ascendingNodeDegrees` is 0, which is only true for Earth).
- `rotationAtEpochDegrees`, `rotationPeriodDays` — axial spin phase/rate. Most planets' `rotationAtEpochDegrees` is empirically fit against real JPL Horizons sub-solar longitude rather than the raw IAU W0 value, since this app's specific texture UV/handedness/tilt setup leaves a small but stable residual offset from the textbook constant — see each planet's own comment for the fitted value and accuracy.

`src/Planet.tsx`'s `tiltOrbitalPosition()` turns eccentric-anomaly-derived 2D orbital-plane coordinates into 3D world position (applies argument of periapsis, then inclination/ascending node), and `polePositionWorld()` converts a planet's real pole RA/Dec into this scene's world frame to orient its mesh as a general 3D quaternion (not a single-axis rotation). Both are annotated in-line with the geometry reasoning: getting handedness/frame conventions wrong here is easy and has been actual shipped bugs before (planets visibly orbited backwards; non-Earth seasons were in the wrong hemisphere) — read the existing comments before changing either, and cross-check any change against real ephemeris data (the [JPL Horizons API](https://ssd.jpl.nasa.gov/api/horizons.api)), not just internal consistency. Two things worth knowing before touching this further:
- Sub-solar *latitude* is verified correct for all 8 planets; sub-solar *longitude* is individually calibrated and verified for Mercury, Earth, Mars, Jupiter, Saturn, and Neptune, but not to the same precision for Uranus (~6-8° residual).
- Venus's sub-solar longitude has a real, currently-unexplained periodic drift against this app's model (~3°/day, repeating every Venus year) that isn't a simple miscalibration — see [issue #2](https://github.com/gstsdev/space-explorer/issues/2) for what's already been ruled out before investigating further.

### Rendering is split by entity: `Scene.tsx` is just the composition root

`Scene.tsx` itself is thin — it maps `PLANETS` to `Planet`s, plus `Sun` and Earth's `Moon`, nothing else. Each body's actual rendering lives in its own top-level file, with that entity's own private sub-components (materials, shells) in a same-named sibling folder:

- `Planet.tsx` (+ `Planet/`) — the Kepler solver (`solveEccentricAnomaly`, Newton-Raphson), the orbital/pole transforms (`tiltOrbitalPosition`, `polePositionWorld`), and `Planet` itself (mesh + orbit line + label + optional ring/atmosphere/clouds). `Planet/TexturedSurface.tsx` (day/night + atmosphere-glow + sunset-tint shader), `Planet/Atmosphere.tsx` (the glow shell), `Planet/PlanetRing.tsx` (Saturn's ring + shadow), `Planet/Clouds.tsx` (see below).
- `Moon.tsx` (+ `Moon/MoonSurface.tsx`) — Earth's Moon specifically (not a generalized "any body can orbit any other body" system — see `astronomy.ts`'s own comment on why).
- `Sun.tsx` (+ `Sun/SunGlare.tsx`) — the sun mesh + its screen-space glare/diffraction-spike billboard.
- Genuinely cross-entity code (used by 2+ of the above) lives in its own root-level module rather than inside any one entity's folder: `sceneCommon.ts` (`hoverCursor`, the `OnFocus` type), `BodyLabel.tsx` (the screen-space name label), `sunProperties.ts` (the sun-occlusion/transit registry — Planet writes to it, Sun reads it), `atmosphereShading.ts` (the shared day/night terminator-fade law — used by Planet's atmosphere/surface shaders *and* Moon's eclipse shading, despite the name).

Notable patterns across this split:

- **LOD / true-scale rendering**: below `ANGULAR_THRESHOLD` (radius/distance), a body renders as a constant-screen-size billboard placeholder instead of its true-scale mesh, since real planets are sub-pixel from realistic viewing distances. The switch distance is computed per-body from its real radius. `Planet`'s own LOD `useFrame` also drives `Atmosphere`'s and `Clouds`' `.visible` (via a `meshRef` passed into each) — they're separate meshes with no LOD logic of their own, so without this they'd stay visible at true scale even once the real surface has swapped to its placeholder.
- **Adaptive camera near plane** (`CameraRig.tsx`): near scales with distance-to-target (`near = max(MIN_NEAR, distance * NEAR_RATIO)`) since true-scale near/far span ~9 orders of magnitude; far stays fixed (`CAMERA_FAR`), sized to not clip the farthest orbit line at max zoom-out — see the constant's own comment for the exact geometry.
- **Object-space sun direction**: each planet computes the sun's direction in its own (rotating) object space per-frame, used by `TexturedSurface`'s day/night terminator shader and `PlanetRing`'s lighting/shadow shader. This makes the terminator/shadow correct regardless of the mesh's own spin without needing per-frame camera-relative recomputation.
- **Saturn's ring shadow** is a pure analytic ray-sphere intersection computed in the ring material's `onBeforeCompile` fragment shader (not a Three.js light/shadow-map), so it's correct on both ring faces simultaneously and can't leak light onto the sphere.

### Custom `<shaderMaterial>`s need to opt into `logarithmicDepthBuffer` by hand

`App.tsx`'s `<Canvas>` enables `gl={{ logarithmicDepthBuffer: true }}` (needed since true-scale distances span ~9 orders of magnitude — see that line's own comment). Built-in materials (`MeshPhongMaterial`, etc., including ones extended via `onBeforeCompile` like `TexturedSurface`/`PlanetRing`) get the matching depth adjustment for free from their template. A raw `<shaderMaterial>` with a hand-rolled `gl_Position` — `Atmosphere.tsx`, `Clouds.tsx`, `SunGlare.tsx` — does **not**: without it, that mesh's depth doesn't actually match what other, correctly-adjusted geometry wrote to the depth buffer, and it silently loses depth tests it should win. This was a real, previously-invisible bug: `Clouds`' shell (meant to cover the whole visible disc) rendered *only* at the silhouette until fixed, because it was losing the depth test against the opaque surface everywhere else. Fix is Three's own `logdepthbuf_pars_vertex`/`logdepthbuf_vertex` and `logdepthbuf_pars_fragment`/`logdepthbuf_fragment` chunks (see `Clouds.tsx` for the exact placement) — the same chunks built-in materials already use internally. Any *new* raw `<shaderMaterial>` that writes its own `gl_Position` needs these too.

### Clouds are the one deliberately non-real thing in this app (`Planet/Clouds.tsx`)

Everything else in this app aims for real, dated-and-verifiable values — clouds can't, because cloud cover has no closed-form "position at date X" the way orbital motion does (it's chaotic weather, not periodic). Rather than a real (but frozen/dated) satellite texture, `Clouds` generates a continuously-morphing procedural pattern: domain-warped fractal noise (simplex + FBM, standard public-domain Ashima Arts implementation), sampled directly by each fragment's 3D surface normal — not a 2D UV, so no seam or pole-pinch — and animated by offsetting the noise field with `simulation.time`. See `PlanetCloudsData`'s own comment in `astronomy.ts` for the full reasoning.

### The `react-hooks/immutability` lint rule shapes a recurring code pattern

Mutating a value obtained from any hook call (`useTexture`, `useThree`, etc.) is flagged — including via `.current` on a ref — *unless* the ref was seeded with a freshly-constructed value (`useRef(new Vector3())`) or a value captured once (`useRef(hookResult)`), then mutated via `.current` inside a `useEffect`/`useFrame`. This pattern shows up throughout `Planet.tsx`/`Moon.tsx`/`Sun.tsx` and their sub-component folders, `Skybox.tsx`, and `CameraRig.tsx` for textures, camera refs, and Three.js objects.

### Camera/controls (`src/CameraRig.tsx`)

Wraps drei's `OrbitControls`. Clicking a body sets `focusTarget` (a ref, not React state — read every frame, no need to re-render on camera movement); the rig smoothly dollies to that body's own `userData.focusDistance`/`userData.minViewDistance` (stashed per-body in `Planet.tsx`/`Moon.tsx`/`Sun.tsx`, scaled to that body's real radius, since "a good look" is a wildly different absolute distance for Mercury vs. the Sun). Zoom speed ramps up during a sustained scroll burst and resets on pause, since true-scale distances span orders of magnitude that a single fixed zoom speed can't comfortably cover.

### Everything else

- `App.tsx` — top-level wiring: `Canvas` + `Scene` + `CameraRig` + `SimulationClock`, plus the non-Canvas UI (`SpeedControl`, `StatsPanel`, `ViewControls`).
- `Skybox.tsx` — equirectangular Milky Way background (`scene.background`), not drei's `Stars` (a real point cloud whose fixed screen-space point size breaks down at this app's true-scale distances).
- `StatsPanel.tsx` / `SpeedControl.tsx` / `ViewControls.tsx` — plain-DOM UI overlaid outside the `Canvas`.
- Textures live in `public/textures/<planet>/`.
- Open bugs/limitations are tracked as GitHub issues on this repo, not in-code TODOs — check there before assuming something is unverified.
