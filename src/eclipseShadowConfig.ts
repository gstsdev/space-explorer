// Runtime-tunable parameters for this app's two analytic eclipse shadows:
// Earth's (the Moon's shadow, cast across Earth during a solar eclipse — see
// Planet/TexturedSurface.tsx) and the Moon's (Earth's shadow, cast across
// the Moon during a lunar eclipse, including the "blood moon" umbral glow —
// see Moon/MoonSurface.tsx).
//
// A plain mutable object read per-frame into shader uniforms, same pattern
// as `simulation` (see simulation.ts): routing it through React state would
// re-render the scene tree on every slider drag. This module exists to give
// the dev-only tuner (src/dev/EclipseShadowDevTools.tsx, stripped from
// production builds) something to mutate live, and to hold the eyeballed
// values that calibrate the analytic shadow model against reference photos.
//
// `scale` fields multiply the shader's own physically-derived quantity;
// `strength` fields are a 0..1 fraction of direct sunlight removed inside
// the shadow (1 = the shader's "sun switched off for this fragment"
// behaviour). RGB triples are raw shader-space colour, not sRGB.

export type EclipseShadowConfig = {
  earth: {
    penumbraScale: number;
    casterRadiusScale: number;
    shadowStrength: number;
  };
  moon: {
    penumbraScale: number;
    casterRadiusScale: number;
    shadowStrength: number;
    // Deep-umbra ("blood moon") glow: sunlight refracted through Earth's
    // atmosphere into the shadow. Real umbrae are not flat — dim and deep
    // red on the shadow axis (light bent through the thickest, lowest air),
    // brightening to a pale grey/turquoise at the umbra edge (thinner air,
    // ozone's blue-green window). So the glow is a radial gradient between
    // two colours and two brightnesses.
    bloodMoonColor: [number, number, number]; // on the shadow axis
    bloodMoonEdgeColor: [number, number, number]; // at the umbra edge
    bloodMoonIntensity: number; // overall glow strength (at the edge)
    umbraCenterDarkening: number; // 0..1, axis brightness relative to the edge
    umbraGradientCurve: number; // <1 spreads the axis colour outward, >1 concentrates it
  };
};

export const ECLIPSE_SHADOW_DEFAULTS: EclipseShadowConfig = {
  earth: {
    penumbraScale: 1,
    casterRadiusScale: 1,
    shadowStrength: 1,
  },
  moon: {
    penumbraScale: 1,
    // 0.9, not 1: the real umbra is if anything ~2% *larger* than geometric
    // (Earth's atmosphere), but at this sim's Moon/shadow geometry the
    // eclipse reads visibly too deep at greatest eclipse — shrinking Earth's
    // effective shadow radius 10% lands the umbra edge where it looks right
    // against reference photos. Eyeballed via the dev panel, not derived.
    casterRadiusScale: 0.9,
    shadowStrength: 1,
    bloodMoonColor: [0.68, 0.19, 0.05],
    bloodMoonEdgeColor: [0.5, 0.34, 0.28],
    bloodMoonIntensity: 0.24,
    umbraCenterDarkening: 0.8,
    umbraGradientCurve: 0.4,
  },
};

function cloneConfig(source: EclipseShadowConfig): EclipseShadowConfig {
  return {
    earth: { ...source.earth },
    moon: {
      ...source.moon,
      bloodMoonColor: [...source.moon.bloodMoonColor],
      bloodMoonEdgeColor: [...source.moon.bloodMoonEdgeColor],
    },
  };
}

export const eclipseShadowConfig: EclipseShadowConfig = cloneConfig(ECLIPSE_SHADOW_DEFAULTS);

// Copies `next` into the live config in place. The shader uniform loops read
// this same object every frame, so mutating it is all that's needed — no
// re-render. Lives here (rather than the dev panel mutating the object
// directly) because the react-hooks/immutability lint rule forbids a
// component writing to a module-level object; a plain module function is
// fine, same as resetEclipseShadowConfig / simulation.ts.
export function applyEclipseShadowConfig(next: EclipseShadowConfig): void {
  eclipseShadowConfig.earth = { ...next.earth };
  eclipseShadowConfig.moon = {
    ...next.moon,
    bloodMoonColor: [...next.moon.bloodMoonColor],
    bloodMoonEdgeColor: [...next.moon.bloodMoonEdgeColor],
  };
}

// Restores every field to ECLIPSE_SHADOW_DEFAULTS.
export function resetEclipseShadowConfig(): void {
  applyEclipseShadowConfig(ECLIPSE_SHADOW_DEFAULTS);
}
