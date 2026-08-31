import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { SRGBColorSpace, Vector3 } from "three";
import { useTexture } from "@react-three/drei";
import { KM_TO_UNITS } from "../astronomy";
import type { MoonData } from "../astronomy";
import { eclipseShadowConfig } from "../eclipseShadowConfig";
import { FRAME_PRIORITY } from "../framePriority";

// The Moon's surface material — split out for the same reason TexturedSurface
// is: useTexture() should only suspend this material, not the whole Moon.
// Much simpler than TexturedSurface, since the Moon needs neither a
// night-lights emissive pass nor an atmosphere rim term — Phong's own
// built-in lighting against the scene's sunlight already produces a correct
// terminator for free. displacementMap/displacementScale give it real (if
// approximate — see MOON_RELIEF_KM) surface relief, which no other body in
// this app uses since none of their placeholder-vs-mesh viewing distances
// make it worth the extra geometry cost.
export function MoonSurface({
  textures,
  tint,
  displacementScale,
  displacementBias,
  sunDirection,
  eclipseShadow,
}: {
  textures: MoonData["textures"];
  // See PlanetData.surfaceTint's own comment. A sibling prop, not a field
  // on textures — that object is passed straight to useTexture() below,
  // which treats every key as an image URL to load.
  tint?: string;
  displacementScale: number;
  displacementBias: number;
  // Object-space (this mesh's own spin frame) direction to the sun — same
  // role as Planet's own sunDirection, added here (unlike the rest of this
  // material, which otherwise relies on Phong's own built-in lighting) only
  // because the eclipse shadow test below needs it.
  sunDirection: RefObject<Vector3>;
  // Real shadow cast by Earth during a lunar eclipse — same analytic
  // ray-sphere technique as TexturedSurface's own eclipseShadow (Earth's
  // own, cast by the Moon) and PlanetRing's ring shadow; see either's doc
  // comment for why this is a pure position/geometry test, and
  // TexturedSurface's eclipseShadow for why the caster's position isn't
  // this surface's own local origin.
  eclipseShadow: { casterPositionObjectSpace: RefObject<Vector3>; casterRadiusKm: number };
}) {
  const maps = useTexture(textures);
  const mapsRef = useRef(maps);
  useEffect(() => {
    mapsRef.current.map.colorSpace = SRGBColorSpace;
    mapsRef.current.map.needsUpdate = true;
  }, [maps]);

  const shaderUniforms = useRef<{
    sunDirection: { value: Vector3 };
    eclipseCasterPosition: { value: Vector3 };
    eclipseCasterRadius: { value: number };
    eclipsePenumbraScale: { value: number };
    eclipseShadowStrength: { value: number };
    bloodMoonColor: { value: Vector3 };
    bloodMoonEdgeColor: { value: Vector3 };
    bloodMoonIntensity: { value: number };
    umbraCenterDarkening: { value: number };
    umbraGradientCurve: { value: number };
  } | null>(null);

  useFrame(() => {
    if (!shaderUniforms.current) return;
    shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
    shaderUniforms.current.eclipseCasterPosition.value.copy(eclipseShadow.casterPositionObjectSpace.current);
    // Live tuning knobs — see src/eclipseShadowConfig.ts.
    const tuning = eclipseShadowConfig.moon;
    shaderUniforms.current.eclipseCasterRadius.value =
      eclipseShadow.casterRadiusKm * KM_TO_UNITS * tuning.casterRadiusScale;
    shaderUniforms.current.eclipsePenumbraScale.value = tuning.penumbraScale;
    shaderUniforms.current.eclipseShadowStrength.value = tuning.shadowStrength;
    shaderUniforms.current.bloodMoonColor.value.set(
      tuning.bloodMoonColor[0],
      tuning.bloodMoonColor[1],
      tuning.bloodMoonColor[2],
    );
    shaderUniforms.current.bloodMoonEdgeColor.value.set(
      tuning.bloodMoonEdgeColor[0],
      tuning.bloodMoonEdgeColor[1],
      tuning.bloodMoonEdgeColor[2],
    );
    shaderUniforms.current.bloodMoonIntensity.value = tuning.bloodMoonIntensity;
    shaderUniforms.current.umbraCenterDarkening.value = tuning.umbraCenterDarkening;
    shaderUniforms.current.umbraGradientCurve.value = tuning.umbraGradientCurve;
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <meshPhongMaterial
      map={maps.map}
      displacementMap={maps.displacementMap}
      displacementScale={displacementScale}
      displacementBias={displacementBias}
      // Multiplies the diffuse map — see PlanetData.surfaceTint's own
      // comment for why the Moon needs this.
      color={tint ?? "#ffffff"}
      specular="#111111"
      shininess={2}
      onBeforeCompile={(shader) => {
        shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };
        shader.uniforms.eclipseCasterPosition = { value: new Vector3() };
        shader.uniforms.eclipseCasterRadius = { value: eclipseShadow.casterRadiusKm * KM_TO_UNITS };
        // Live tuning knobs — see src/eclipseShadowConfig.ts. These initial
        // values are placeholders; the per-frame loop above drives them all
        // from that mutable config (which holds the real calibrated values).
        shader.uniforms.eclipsePenumbraScale = { value: 1 };
        shader.uniforms.eclipseShadowStrength = { value: 1 };
        shader.uniforms.bloodMoonColor = { value: new Vector3(0.65, 0.2, 0.05) };
        shader.uniforms.bloodMoonEdgeColor = { value: new Vector3(0.32, 0.3, 0.26) };
        shader.uniforms.bloodMoonIntensity = { value: 0.2 };
        shader.uniforms.umbraCenterDarkening = { value: 0.5 };
        shader.uniforms.umbraGradientCurve = { value: 0.6 };
        shaderUniforms.current = shader.uniforms as unknown as {
          sunDirection: { value: Vector3 };
          eclipseCasterPosition: { value: Vector3 };
          eclipseCasterRadius: { value: number };
          eclipsePenumbraScale: { value: number };
          eclipseShadowStrength: { value: number };
          bloodMoonColor: { value: Vector3 };
          bloodMoonEdgeColor: { value: Vector3 };
          bloodMoonIntensity: { value: number };
          umbraCenterDarkening: { value: number };
          umbraGradientCurve: { value: number };
        };

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjectPosition;\nvarying vec3 vObjectNormal;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjectPosition = position;")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjectNormal = objectNormal;");

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vObjectPosition;\nvarying vec3 vObjectNormal;\nuniform vec3 sunDirection;\nuniform vec3 eclipseCasterPosition;\nuniform float eclipseCasterRadius;\nuniform float eclipsePenumbraScale;\nuniform float eclipseShadowStrength;\nuniform vec3 bloodMoonColor;\nuniform vec3 bloodMoonEdgeColor;\nuniform float bloodMoonIntensity;\nuniform float umbraCenterDarkening;\nuniform float umbraGradientCurve;",
          )
          // Same ray-sphere shadow test as TexturedSurface's own
          // eclipseShadow — including the soft penumbra edge; see that
          // component's doc comment for why a hard edge (like PlanetRing's
          // ring shadow) reads as visibly wrong at Earth-Moon range.
          .replace(
            "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;",
            `vec3 toEclipseSun = normalize(sunDirection);
            vec3 casterOffset = vObjectPosition - eclipseCasterPosition;
            float eb = dot(casterOffset, toEclipseSun);
            // Perpendicular distance from Earth's centre to this fragment's
            // ray toward the sun (the impact parameter) — the quantity the
            // soft shadow edge is measured against.
            float impactParameter = sqrt(max(dot(casterOffset, casterOffset) - eb * eb, 0.0));
            // Earth's umbra is a *cone*: it tapers as it recedes from
            // Earth, shrinking by the sun's angular radius (~0.266°,
            // tan ≈ 0.00464) times the distance travelled (abs(eb)). Over
            // the ~385,000 km Earth→Moon throw that taper is ~1,800 km —
            // nearly a third of Earth's radius — so testing against Earth's
            // *full* radius (as PlanetRing's ring shadow does, where the sun
            // subtends far less and the throw is short) painted the shadow
            // well outside the real umbra, across the whole sunlit disc
            // whenever the Moon was merely near the eclipse axis.
            float sunTaper = abs(eb) * 0.00464;
            float umbraRadius = max(eclipseCasterRadius - sunTaper, 0.0);
            // The real penumbra is ~2*sunTaper wide, but its dimming is
            // perceptually negligible (penumbral lunar eclipses are famously
            // hard to even notice) and a camera blows the un-eclipsed limb
            // out to white regardless — so the umbra edge should read nearly
            // crisp, like an eclipse photo, not fade across a third of the
            // disc. This models just a thin soft edge (~450 km at scale 1);
            // eclipsePenumbraScale widens it toward the full physical
            // penumbra if wanted.
            float penumbraRadius = umbraRadius + 0.25 * sunTaper * eclipsePenumbraScale;
            float geometricEclipseShadow = eb < 0.0 ? 1.0 - smoothstep(umbraRadius, penumbraRadius, impactParameter) : 0.0;
            // Sunlit fraction of this fragment — 0 at and past the Moon's
            // own terminator (dot <= 0), easing to 1 over the first ~8° onto
            // the lit side. Only the blood-moon glow below is gated by this,
            // NOT the direct-light suppression: the glow is scaled by raw
            // albedo, so any of it leaking past the terminator paints a
            // bright band onto genuinely unlit surface; the suppression, by
            // contrast, must follow the umbra alone — where Earth blocks the
            // sun the grazing sunlight has to go, terminator or not, and
            // gating it here instead left a bright un-suppressed sliver of
            // that grazing light right at the terminator.
            float sunlitFraction = smoothstep(0.0, 0.14, dot(normalize(vObjectNormal), toEclipseSun));
            // See TexturedSurface's own eclipseShadow for why this only
            // suppresses the *direct* light terms rather than darkening
            // everything: an eclipsed fragment should read the same as this
            // surface's own geometric night side, not a separate, arbitrarily
            // darker tint.
            float directLightFactor = 1.0 - geometricEclipseShadow * eclipseShadowStrength;

            // Earth's own eclipseShadow (the Moon's shadow on Earth) stops at
            // the line above — but a real lunar eclipse doesn't go fully dark
            // the way a plain "no direct light" surface would: sunlight
            // refracted through Earth's atmosphere (the same bending +
            // reddening that makes a sunset) still reaches the Moon deep
            // inside the umbra, lighting it that dim red/orange — the classic
            // "blood moon".
            //
            // And that refracted light is not flat across the umbra. Light
            // reaching the shadow *axis* bent the most, through the thickest,
            // lowest slice of atmosphere: dimmest and deepest red. Light
            // reaching the umbra *edge* bent less, through thinner, higher
            // air where ozone's blue-green transmission window shows: brighter
            // and greyer/turquoise. So this is a radial gradient. umbraDepth
            // is 0 at the umbra edge, 1 on the axis; umbraGradientCurve < 1
            // spreads the axis colour outward, > 1 pins it to the centre.
            float umbraDepth = clamp(1.0 - impactParameter / max(umbraRadius, 1e-4), 0.0, 1.0);
            float umbraBlend = pow(umbraDepth, umbraGradientCurve);
            vec3 umbraColor = mix(bloodMoonEdgeColor, bloodMoonColor, umbraBlend);
            float umbraBrightness = mix(1.0, umbraCenterDarkening, umbraBlend);
            // Modulated by diffuseColor (this fragment's own surface albedo)
            // so it still reads as the Moon's own surface glowing, not a flat
            // wash, and by geometricEclipseShadow so it fades in across the
            // same penumbra the direct light fades out across (and by
            // sunlitFraction so it stops at the Moon's own terminator).
            vec3 bloodMoonGlow = umbraColor * diffuseColor.rgb * bloodMoonIntensity * umbraBrightness * geometricEclipseShadow * sunlitFraction;

            vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.directSpecular) * directLightFactor + bloodMoonGlow + reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular + totalEmissiveRadiance;`,
          );
      }}
    />
  );
}
