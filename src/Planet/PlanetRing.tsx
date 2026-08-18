import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, ClampToEdgeWrapping, DoubleSide, RepeatWrapping, RingGeometry, Vector3 } from "three";
import { useTexture } from "@react-three/drei";
import type { Quaternion } from "three";
import type { PlanetRingData } from "../astronomy";
import { FRAME_PRIORITY } from "../framePriority";

export function PlanetRing({
  ring,
  ringQuaternion,
  radius,
  sunDirection,
}: {
  ring: PlanetRingData;
  ringQuaternion: Quaternion;
  radius: number;
  sunDirection: RefObject<Vector3>;
}) {
  const texture = useTexture(ring.texture);
  const textureRef = useRef(texture);
  const shaderUniforms = useRef<{ sunDirection: { value: Vector3 } } | null>(
    null,
  );

  const ringGeometry = useMemo(() => {
    const innerRadius = radius * ring.innerRadiusRatio;
    const outerRadius = radius * ring.outerRadiusRatio;
    const geometry = new RingGeometry(innerRadius, outerRadius, 256, 1);
    const position = geometry.getAttribute("position");
    const uv = new Float32Array(position.count * 2);
    const radiusRange = outerRadius - innerRadius;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const theta = Math.atan2(y, x);
      const r = Math.sqrt(x * x + y * y);
      // The ring texture is a vertical slice where width maps to radius and
      // height maps to circumference, so swap the UV axes from the standard
      // ring parameterization.
      uv[i * 2] = (r - innerRadius) / radiusRange;
      uv[i * 2 + 1] = (theta + Math.PI) / (2 * Math.PI);
    }

    geometry.setAttribute("uv", new BufferAttribute(uv, 2));
    return geometry;
  }, [radius, ring.innerRadiusRatio, ring.outerRadiusRatio]);

  useEffect(() => {
    if (texture) {
      textureRef.current = texture;
      textureRef.current.rotation = 0;
      textureRef.current.center.set(0.5, 0.5);
      textureRef.current.wrapS = ClampToEdgeWrapping;
      textureRef.current.wrapT = RepeatWrapping;
      textureRef.current.repeat.set(1, 1);
      textureRef.current.needsUpdate = true;
    }
  }, [texture]);

  useFrame(() => {
    if (shaderUniforms.current)
      shaderUniforms.current.sunDirection.value.copy(sunDirection.current);
  }, FRAME_PRIORITY.updateVisibility);

  return (
    <mesh geometry={ringGeometry} quaternion={ringQuaternion}>
      <meshPhongMaterial
        map={texture}
        transparent
        alphaTest={0.05}
        opacity={ring.opacity ?? 0.9}
        side={DoubleSide}
        depthWrite={false}
        shininess={5}
        specular="#222222"
        onBeforeCompile={(shader) => {
          shader.uniforms.sunDirection = { value: new Vector3(0, 0, 1) };
          shader.uniforms.planetRadius = { value: radius };
          shaderUniforms.current = shader.uniforms as unknown as { sunDirection: { value: Vector3 } };

          // vRingLocalPosition carries each fragment's un-rotated local
          // position (same space RingGeometry's vertices are authored in,
          // and the same space sunDirection below is expressed in) through
          // to the fragment shader, for the ray-sphere shadow test below.
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vRingLocalPosition;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRingLocalPosition = position;");

          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vRingLocalPosition;\nuniform vec3 sunDirection;\nuniform float planetRadius;",
            )
            // A real ring isn't an opaque sheet — it's countless ice/dust
            // particles, so even lit edge-on (sun near the ring's own plane)
            // it stays faintly visible via forward-scattering. An idealized
            // Lambertian disc has no such thing: dot(normal, sunDir) → 0
            // exactly at that crossing, so standard Phong shading goes fully
            // black there, which reads as a rendering bug rather than the
            // physically-expected (if exaggerated) ring-plane-crossing dimming.
            // RingGeometry's un-rotated per-vertex normal is always (0,0,1),
            // and sunDirection is already in this mesh's own object space
            // (computed in Planet from the same fixed rotation this mesh
            // carries), so no vertex-shader work is needed here — just
            // compare against a constant.
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float ringNdotL = dot(vec3(0.0, 0.0, 1.0), normalize(sunDirection));
              float grazing = 1.0 - abs(ringNdotL);
              totalEmissiveRadiance += diffuseColor.rgb * grazing * 0.35;`,
            )
            // Real (analytic) ray-sphere shadow test: is the sun blocked by
            // the planet as seen from this point on the ring? Unlike a
            // normal-based light, this is a pure position/geometry test —
            // correct on both ring faces at once (the planet blocks light
            // for the whole umbra region, not just "whichever face happens
            // to point sunward"), and confined entirely to this material, so
            // it can never spill extra brightness onto the sphere the way a
            // real scene light would (Three.js has no per-object light
            // exclusion, which is why we're not using one for this anymore).
            //
            // Deliberately a hard edge, not softened: the sun's angular size
            // from Saturn (~9.5 AU) is only ~0.056°, so the real penumbra
            // works out to a fraction of a percent of Saturn's own radius —
            // imperceptible at this scale. A stylized blur here would be
            // less accurate than the sharp edge real photos actually show.
            .replace(
              "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;",
              `vec3 toSun = normalize(sunDirection);
              float b = dot(vRingLocalPosition, toSun);
              float c = dot(vRingLocalPosition, vRingLocalPosition) - planetRadius * planetRadius;
              float h = b * b - c;
              float inShadow = (h > 0.0 && (-b - sqrt(h)) > 0.0) ? 1.0 : 0.0;
              float ringShadowFactor = mix(1.0, 0.25, inShadow);

              vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance) * ringShadowFactor;`,
            );
        }}
      />
    </mesh>
  );
}
