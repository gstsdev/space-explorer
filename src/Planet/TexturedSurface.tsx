import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, SRGBColorSpace, Vector3 } from "three";
import { useTexture } from "@react-three/drei";
import { KM_TO_UNITS } from "../astronomy";
import type { PlanetAtmosphereData, PlanetTextures } from "../astronomy";
import { eclipseShadowConfig } from "../eclipseShadowConfig";
import { FRAME_PRIORITY } from "../framePriority";
import { ATMOSPHERE_TERMINATOR_FADE_DOT, atmosphereIntensity } from "../atmosphereShading";

// Textured surface material — split out so its useTexture() suspends only
// this material, not the whole planet, while the maps load. MeshPhongMaterial
// (not MeshStandardMaterial, used everywhere else) specifically because its
// specular/shininess model is what specularMap textures — including the
// classic "grayscale ocean mask" Earth specular maps — are authored for.
//
// nightMap (city lights) needs logic no built-in material has: emissive only
// on the side facing away from the sun. Rather than write a lighting shader
// from scratch, this extends Phong's own compiled shader via onBeforeCompile
// — injecting a varying for the un-transformed (object-space) normal and a
// sunDirection uniform (also object-space, so it's correct regardless of
// this mesh's own spin — see Planet, where it's computed each frame from the
// same rotation this mesh already applies to itself, no camera/world-matrix
// timing to get wrong), then adding the night texture as emissive light
// wherever that surface point faces away from the sun.
//
// atmosphere (optional) adds a second, independent effect through the same
// onBeforeCompile patch: a radial gradient across the whole visible
// hemisphere, coupling the external Atmosphere shell's glow down onto the
// surface it's wrapping (real limb brightening lights the edge of the
// daylit ground itself, not just the air above it) — transparent at the
// point facing the camera dead-on, easing toward the atmosphere color at
// the grazing silhouette, always recentering on the camera since it's
// computed from the live view direction every frame. Unlike the day/night
// split above, this needs that view-dependent grazing angle, so it reuses
// Phong's own built-in vNormal/vViewPosition varyings (already view-space,
// already correct for this mesh's live rotation via the standard
// normalMatrix/modelViewMatrix three.js recomputes every frame) rather than
// the object-space vObjectNormal/sunDirection pair above — no camera matrix
// exists in that object-space pair to project a view angle through.
//
// Deliberately subtle (see atmosphereIntensity) — the shell already carries
// the limb glow on its own, so this is a soft reinforcement where the two
// overlap toward the edge, not a second full-strength copy of it.
const SURFACE_GLOW_FACTOR = 0.15;

// sunsetColor (optional, see PlanetAtmosphereData): a third, independent
// effect through the same onBeforeCompile patch — a color tint keyed purely
// on dot(vObjectNormal, sunDirection) (the same object-space pair the
// night-lights term above uses), with no view-angle/rim gating at all. That
// matters: the Atmosphere shell's own glow (and this file's radial-gradient
// term just below) both fade to ~0 away from the grazing silhouette, so
// neither can show color anywhere except right at the limb — meaning a
// color band keyed to terminator proximity only ever shows where the
// terminator happens to cross that silhouette (two points), not along its
// whole visible curve across the disc the way real limb-glow photos from
// orbit show it. An earlier attempt at a terminator-proximity tint lived on
// the Atmosphere shell instead (mixed into its rim glow, see tintedGlsl's
// own comment there) and was reverted for exactly that reason, plus a
// concrete, visible bug: near-degenerate sun/camera viewing angles made the
// two-point footprint smear into a long streak along the limb (rim and
// terminator are two independent great circles that go near-tangent at
// those two points). This term sidesteps both problems structurally, not
// just by tuning: keyed on a single band (terminator proximity) with no
// second curved band (view angle) intersecting it, it has no near-tangent
// geometry to go degenerate, and since it's unrelated to view angle it
// shows wherever the terminator is visible on the sphere, including
// straight across the middle of the disc — matching real photos instead of
// only flaring at the limb.
//
// Mixed into diffuseColor (see the map_fragment injection below), not added
// to totalEmissiveRadiance — a real sunset tints the *ground itself*, still
// subject to the sun's own lighting falloff (so it dims toward night like
// everything else this material renders), rather than an extra light
// shining on top of the scene regardless of local illumination.

// Shapes the radial gradient above: the raw Fresnel term (1 - |dot(N,V)|)
// is 0 at the point facing the camera and 1 at the true silhouette,
// already exactly the gradient wanted, so this just weights it toward the
// edge (rather than a linear ramp visible across the whole disk) — higher
// pulls the visible color closer to the edge, 1.0 would make it fully linear.
const ATMOSPHERE_SURFACE_GRADIENT_EXPONENT = 2;

// This term's own night floor — deliberately much lower than the Atmosphere
// shell's ATMOSPHERE_UNTINTED_NIGHT_DARKEN, not shared with it. The shell
// floats over black space either way, day or night, so darkening it instead
// of fading it out reads as "the same object, dimmer." This term is painted
// on the ground itself, which on the night side is otherwise essentially
// black (no direct light there) — so even a 20%-strength glow (the shell's
// floor) stands out starkly against that black backdrop, reading as
// *stronger* than the day side despite being dimmer in absolute terms. A
// much lower floor keeps it barely-there instead of a false highlight.
const ATMOSPHERE_SURFACE_NIGHT_DARKEN = 0.05;

// TexturedSurface's sunset band (see this file's own sunsetColor comment for
// why it's a surface-level term keyed purely on local sun elevation, not a
// rim/view-angle-gated one like the Atmosphere shell's earlier, reverted
// twilight-tint attempt). A Gaussian falloff centered on the terminator
// (dot(N, sunDir) = 0), not a triangular ramp between fixed start/end
// angles — a triangle's straight sides meeting at sharp corners is exactly
// what reads as a hard-edged "band" rather than a natural glow; a Gaussian
// has no corners anywhere; it just asymptotically fades out, so there's no
// specific angle where an edge is visible. This constant is its standard
// deviation in dot-product units — since d(cosθ)/dθ ≈ 1 per radian near
// θ=90°, 0.01 corresponds to a ~0.6° standard deviation. Eyeballed against
// the running app rather than derived.
const SUNSET_BAND_SIGMA = 0.01;

// Max diffuseColor blend toward sunsetColor, right at the terminator itself
// (see the mapAdditions comment below for why this mixes into diffuseColor
// rather than adding emissive light). Also eyeballed live.
const SUNSET_TINT_STRENGTH = 0.2;

export function TexturedSurface({
  textures,
  tint,
  sunDirection,
  atmosphere,
  eclipseShadow,
}: {
  textures: PlanetTextures;
  // See PlanetData.surfaceTint's own comment. A sibling prop, not a field
  // on textures — that object is passed straight to useTexture() below,
  // which treats every key as an image URL to load.
  tint?: string;
  sunDirection: RefObject<Vector3>;
  atmosphere?: PlanetAtmosphereData;
  // Only ever set for Earth (see astronomy.ts's own comment on why the
  // Moon is scoped specifically, not generalized to every planet): casts a
  // real shadow onto this surface during a solar eclipse, via the same
  // analytic ray-sphere technique PlanetRing already uses for Saturn's own
  // ring shadow — see that component's doc comment for why this is a pure
  // position/geometry test rather than a real scene light/shadow map.
  // casterPositionObjectSpace is the caster's live position in this mesh's
  // own (spinning) object space — the same frame vObjectPosition below is
  // in — recomputed every frame by this planet's own Planet component.
  eclipseShadow?: { casterPositionObjectSpace: RefObject<Vector3>; casterRadiusKm: number };
}) {
  const maps = useTexture(textures);
  const mapsRef = useRef(maps);
  // useTexture loads via a plain THREE.TextureLoader, which defaults every
  // texture's colorSpace to linear (NoColorSpace) — correct for normalMap
  // (direction data, not color), but wrong for the three photographic maps.
  // Left as linear, a "near-black" pixel in nightMap (which should decode to
  // close to zero) instead samples much brighter than authored, which is
  // exactly what showed up as a "bright blue" glow across Earth's dark side.
  useEffect(() => {
    mapsRef.current.map.colorSpace = SRGBColorSpace;
    mapsRef.current.map.needsUpdate = true;
    if (mapsRef.current.specularMap) {
      mapsRef.current.specularMap.colorSpace = SRGBColorSpace;
      mapsRef.current.specularMap.needsUpdate = true;
    }
    if (mapsRef.current.nightMap) {
      mapsRef.current.nightMap.colorSpace = SRGBColorSpace;
      mapsRef.current.nightMap.needsUpdate = true;
    }
  }, [maps]);

  const shaderUniforms = useRef<{
    sunDirection: { value: Vector3 };
    eclipseCasterPosition?: { value: Vector3 };
    eclipseCasterRadius?: { value: number };
    eclipsePenumbraScale?: { value: number };
    eclipseShadowStrength?: { value: number };
  } | null>(null);

  useFrame(() => {
    if (!shaderUniforms.current) return;
    shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
    if (eclipseShadow && shaderUniforms.current.eclipseCasterPosition) {
      shaderUniforms.current.eclipseCasterPosition.value.copy(eclipseShadow.casterPositionObjectSpace.current);
      // Live tuning knobs (src/eclipseShadowConfig.ts) — defaults leave the
      // shadow exactly as the shader's own physically-derived geometry.
      const tuning = eclipseShadowConfig.earth;
      shaderUniforms.current.eclipseCasterRadius!.value =
        eclipseShadow.casterRadiusKm * KM_TO_UNITS * tuning.casterRadiusScale;
      shaderUniforms.current.eclipsePenumbraScale!.value = tuning.penumbraScale;
      shaderUniforms.current.eclipseShadowStrength!.value = tuning.shadowStrength;
    }
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <meshPhongMaterial
      map={maps.map}
      normalMap={maps.normalMap}
      specularMap={maps.specularMap}
      // Multiplies the diffuse map — see PlanetData.surfaceTint's own
      // comment for why some planets need this. `color` defaults to white
      // (a no-op multiply) when the planet doesn't set one.
      color={tint ?? "#ffffff"}
      // Phong's specular highlight is meant to be masked by specularMap
      // (see this file's own doc comment — Earth's grayscale ocean mask is
      // what it's authored for), not applied full-strength to a bare rocky
      // surface: a planet with no specularMap has no per-pixel data saying
      // *where* it should shine, so a flat "#333333" reads as an ungated
      // gloss over the whole disc — invisible while the surface was still
      // overexposed toward white, but a visibly wrong "wet reflection" once
      // surfaceTint brought the diffuse back into a normal range (Mercury).
      specular={maps.specularMap ? "#333333" : "#000000"}
      shininess={15}
      // Three's default customProgramCacheKey() is just onBeforeCompile.
      // toString() — identical source text for every planet, since they all
      // share this one component. Without overriding it, planets whose
      // onBeforeCompile takes a *different* branch below (nightMap/
      // atmosphere/sunsetColor/eclipseShadow present or not) still hash to
      // the same WebGL program cache key, so whichever planet's material
      // compiles first "wins" the shared GPU program for all of them —
      // including ones that never set the resulting uniforms (e.g. Mercury
      // reusing a program compiled for Venus's atmosphere glow), leaving
      // those uniform slots holding another planet's stale leftover value.
      // This key must vary with every prop that changes which branch below
      // actually runs, so each distinct shader shape gets its own program.
      customProgramCacheKey={() =>
        `nightMap:${Boolean(maps.nightMap)}|atmosphere:${Boolean(atmosphere)}|sunset:${Boolean(atmosphere?.sunsetColor)}|eclipse:${Boolean(eclipseShadow)}`
      }
      onBeforeCompile={(shader) => {
        if (!maps.nightMap && !atmosphere && !eclipseShadow) return;

        shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };

        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vObjectNormal;")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvObjectNormal = objectNormal;");

        let uniformDeclarations = "#include <common>\nvarying vec3 vObjectNormal;\nuniform vec3 sunDirection;";
        let emissiveAdditions = "#include <emissivemap_fragment>";
        let mapAdditions = "#include <map_fragment>";

        if (maps.nightMap) {
          shader.uniforms.nightMap = { value: maps.nightMap };
          uniformDeclarations += "\nuniform sampler2D nightMap;";
          emissiveAdditions += `
            float dayFactor = smoothstep(-0.15, 0.15, dot(normalize(vObjectNormal), normalize(sunDirection)));
            totalEmissiveRadiance += texture2D(nightMap, vMapUv).rgb * (1.0 - dayFactor);`;
        }

        if (atmosphere) {
          shader.uniforms.atmosphereColor = { value: new Color(atmosphere.color) };
          shader.uniforms.atmosphereIntensity = {
            value: atmosphereIntensity(atmosphere.relativeSurfacePressure) * SURFACE_GLOW_FACTOR,
          };
          uniformDeclarations += "\nuniform vec3 atmosphereColor;\nuniform float atmosphereIntensity;";
          // vNormal/vViewPosition are Phong's own built-in varyings (declared
          // by normal_pars_fragment/lights_phong_pars_fragment, already in
          // scope by this point in the template) — see this component's own
          // doc comment for why the rim term uses these instead of the
          // object-space pair above.
          emissiveAdditions += `
            // Radial gradient across the whole visible hemisphere: 0 (fully
            // transparent) at the point facing the camera dead-on, easing
            // toward 1 (full atmosphereColor) at the grazing silhouette —
            // see ATMOSPHERE_SURFACE_GRADIENT_EXPONENT and this component's
            // own doc comment.
            float atmosphereRimBase = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
            float atmosphereRim = pow(atmosphereRimBase, ${ATMOSPHERE_SURFACE_GRADIENT_EXPONENT}.0);
            // Darkens toward night rather than fading out (same shape as
            // the Atmosphere shell's day/night law), but with its own,
            // much lower floor — see ATMOSPHERE_SURFACE_NIGHT_DARKEN for
            // why this can't just reuse the shell's.
            float atmosphereDaylight = smoothstep(${ATMOSPHERE_TERMINATOR_FADE_DOT}, 0.0, dot(normalize(vObjectNormal), normalize(sunDirection)));
            vec3 atmosphereFinalColor = mix(atmosphereColor * ${ATMOSPHERE_SURFACE_NIGHT_DARKEN}, atmosphereColor, atmosphereDaylight);
            totalEmissiveRadiance += atmosphereFinalColor * atmosphereRim * atmosphereIntensity;`;
        }

        if (atmosphere?.sunsetColor) {
          shader.uniforms.sunsetColor = { value: new Color(atmosphere.sunsetColor) };
          shader.uniforms.sunsetStrength = { value: SUNSET_TINT_STRENGTH };
          uniformDeclarations += "\nuniform vec3 sunsetColor;\nuniform float sunsetStrength;";
          // See SUNSET_TINT_STRENGTH's own comment for why this mixes into
          // diffuseColor (injected right after #include <map_fragment> sets
          // it from the base texture) rather than adding to
          // totalEmissiveRadiance like the other two effects above.
          mapAdditions += `
            float sunsetDot = dot(normalize(vObjectNormal), normalize(sunDirection));
            float sunsetBand = exp(-(sunsetDot * sunsetDot) / (2.0 * ${SUNSET_BAND_SIGMA} * ${SUNSET_BAND_SIGMA}));
            diffuseColor.rgb = mix(diffuseColor.rgb, sunsetColor, sunsetBand * sunsetStrength);`;
        }

        let fragmentShader = shader.fragmentShader
          .replace("#include <common>", uniformDeclarations)
          .replace("#include <map_fragment>", mapAdditions)
          .replace("#include <emissivemap_fragment>", emissiveAdditions);

        if (eclipseShadow) {
          shader.uniforms.eclipseCasterPosition = { value: new Vector3() };
          shader.uniforms.eclipseCasterRadius = { value: eclipseShadow.casterRadiusKm * KM_TO_UNITS };
          // Live tuning knobs — see src/eclipseShadowConfig.ts. Both default
          // to 1 (a no-op), driven per-frame from that mutable config above.
          shader.uniforms.eclipsePenumbraScale = { value: 1 };
          shader.uniforms.eclipseShadowStrength = { value: 1 };

          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vObjectPosition;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjectPosition = position;");

          fragmentShader = fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vObjectPosition;\nuniform vec3 eclipseCasterPosition;\nuniform float eclipseCasterRadius;\nuniform float eclipsePenumbraScale;\nuniform float eclipseShadowStrength;",
            )
            // Real ray-sphere shadow test — same core technique as
            // PlanetRing's own ring-shadow shader, generalized for a caster
            // that isn't at this surface's own local origin (unlike a
            // planet's ring, which is always centered on the planet it
            // shadows, the Moon sits off at its own position relative to
            // Earth — see eclipseCasterPosition's own doc comment above):
            // the shadow cone is centered on the axis through
            // eclipseCasterPosition rather than through (0,0,0), so
            // casterOffset (fragment relative to that center) stands in for
            // PlanetRing's vRingLocalPosition.
            //
            // Unlike the ring shadow, this one models the real *cone*
            // rather than the caster's full radius, and is deliberately
            // *not* a hard edge. The ring shadow's own comment notes the
            // sun's real angular size (~0.056° from Saturn) makes both the
            // cone taper and the penumbra a fraction of a percent of
            // Saturn's radius over the ring span — genuinely imperceptible.
            // At Earth↔Moon range the same real half-angle (~0.266°, the
            // sun's angular radius, effectively equal from Earth or Moon)
            // works out to ~1,800 km of taper and a comparable penumbra
            // over the ~385,000 km throw — nearly a third of the caster's
            // radius — so using the full radius and a hard edge both read
            // as visibly wrong here, smearing the shadow far outside the
            // real umbra.
            .replace(
              "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;",
              `vec3 toEclipseSun = normalize(sunDirection);
              vec3 casterOffset = vObjectPosition - eclipseCasterPosition;
              float eb = dot(casterOffset, toEclipseSun);
              // Perpendicular distance from the caster's centre to this
              // fragment's ray toward the sun (the impact parameter) — the
              // quantity the soft shadow edge is measured against.
              float impactParameter = sqrt(max(dot(casterOffset, casterOffset) - eb * eb, 0.0));
              // Umbra radius of the real shadow cone at this fragment's
              // distance behind the caster (abs(eb)): the umbra shrinks by
              // the sun's angular radius (~0.266°, tan ≈ 0.00464) times that
              // distance. The real penumbra is ~2*sunTaper wide but its
              // dimming is perceptually negligible and the lit surface blows
              // out to white regardless, so the edge reads nearly crisp —
              // just a thin soft band. eclipsePenumbraScale widens it.
              float sunTaper = abs(eb) * 0.00464;
              float umbraRadius = max(eclipseCasterRadius - sunTaper, 0.0);
              float penumbraRadius = umbraRadius + 0.25 * sunTaper * eclipsePenumbraScale;
              float inEclipseShadow = eb < 0.0 ? 1.0 - smoothstep(umbraRadius, penumbraRadius, impactParameter) : 0.0;
              // Suppresses only the *direct* light terms (as if the sun
              // itself switched off for this fragment), leaving indirect/
              // ambient and emissive untouched — an eclipsed, sun-facing
              // fragment should read the same as this surface's own
              // geometric night side (which is exactly this: directDiffuse/
              // directSpecular ≈ 0 from the N·L clamp, indirectDiffuse and
              // emissive unaffected), not an arbitrary darker/flatter tint.
              float directLightFactor = 1.0 - inEclipseShadow * eclipseShadowStrength;

              vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.directSpecular) * directLightFactor + reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular + totalEmissiveRadiance;`,
            );
        }

        shader.fragmentShader = fragmentShader;
        shaderUniforms.current = shader.uniforms as unknown as {
          sunDirection: { value: Vector3 };
          eclipseCasterPosition?: { value: Vector3 };
          eclipseCasterRadius?: { value: number };
          eclipsePenumbraScale?: { value: number };
          eclipseShadowStrength?: { value: number };
        };
      }}
    />
  );
}
