import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { SRGBColorSpace, Vector3 } from "three";
import { useTexture } from "@react-three/drei";
import { KM_TO_UNITS } from "../astronomy";
import type { MoonData } from "../astronomy";
import { FRAME_PRIORITY } from "../framePriority";
import { ATMOSPHERE_TERMINATOR_FADE_DOT } from "../atmosphereShading";

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
  } | null>(null);

  useFrame(() => {
    if (!shaderUniforms.current) return;
    shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
    shaderUniforms.current.eclipseCasterPosition.value.copy(eclipseShadow.casterPositionObjectSpace.current);
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
        shaderUniforms.current = shader.uniforms as unknown as {
          sunDirection: { value: Vector3 };
          eclipseCasterPosition: { value: Vector3 };
        };

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjectPosition;\nvarying vec3 vObjectNormal;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjectPosition = position;")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjectNormal = objectNormal;");

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vObjectPosition;\nvarying vec3 vObjectNormal;\nuniform vec3 sunDirection;\nuniform vec3 eclipseCasterPosition;\nuniform float eclipseCasterRadius;",
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
            float ec = dot(casterOffset, casterOffset) - eclipseCasterRadius * eclipseCasterRadius;
            float eh = eb * eb - ec;
            float closestApproach = sqrt(max(eclipseCasterRadius * eclipseCasterRadius - eh, 0.0));
            float edgeDistance = closestApproach - eclipseCasterRadius;
            float penumbraWidth = abs(eb) * 0.00873;
            // The ray-sphere test above is purely geometric — it doesn't
            // know this fragment might already be on the Moon's own
            // natural night side (facing away from the sun entirely,
            // self-occluded by the Moon's own bulk long before any ray
            // toward the sun could reach Earth). Without this check,
            // "in eclipse shadow" reads true across the *whole* Moon
            // during an eclipse, not just the half that would otherwise be
            // sunlit — showing the blood-moon glow on the already-dark far
            // side too. Smoothstep, not a hard >0.0 cutoff: this sits right
            // next to Phong's own N·L-driven falloff, which fades
            // continuously through the terminator rather than switching
            // off — a hard cutoff here created a visible seam at exactly
            // the terminator (the blood-moon glow snapping on/off) where
            // the underlying lighting itself has no such edge. Reuses the
            // same fade band every other terminator effect in this app
            // does (see ATMOSPHERE_TERMINATOR_FADE_DOT's own comment).
            float dayFacing = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(normalize(vObjectNormal), toEclipseSun));
            float geometricEclipseShadow = eb < 0.0 ? 1.0 - smoothstep(-penumbraWidth, penumbraWidth, edgeDistance) : 0.0;
            float inEclipseShadow = geometricEclipseShadow * dayFacing;
            // See TexturedSurface's own eclipseShadow for why this only
            // suppresses the *direct* light terms rather than darkening
            // everything: an eclipsed fragment should read the same as
            // this surface's own geometric night side, not a separate,
            // arbitrarily darker tint. Earth's own eclipseShadow (the
            // Moon's shadow on Earth) stops here — but a real lunar
            // eclipse doesn't go fully dark the way a plain "no direct
            // light" surface would: sunlight refracted through Earth's
            // atmosphere (the same effect that reddens a sunset) still
            // dimly reaches the Moon even deep in Earth's umbra, tinting
            // it that same real red/orange rather than gray — the classic
            // "blood moon". Modulated by diffuseColor (this fragment's own
            // lit surface color) so it still reads as the Moon's own
            // surface glowing that color, not a flat wash on top of it,
            // and scaled by inEclipseShadow so it fades in gradually
            // across the same penumbra the direct light fades out across.
            float directLightFactor = 1.0 - inEclipseShadow;
            vec3 bloodMoonColor = vec3(0.65, 0.2, 0.05);
            vec3 bloodMoonGlow = bloodMoonColor * diffuseColor.rgb * 0.2 * inEclipseShadow;

            vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.directSpecular) * directLightFactor + bloodMoonGlow + reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular + totalEmissiveRadiance;`,
          );
      }}
    />
  );
}
