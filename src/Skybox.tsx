import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { EquirectangularReflectionMapping, SRGBColorSpace } from "three";

// Real background stars are light-years away — utterly negligible next to
// this solar system's ~4600-unit scale — so unlike drei's Stars (a real 3D
// point cloud with real camera-relative size, which is why it visibly shrank
// and vanished well before the edge of the system), the sky should never
// change with camera position, only rotation. scene.background does exactly
// that: Three renders it using only the camera's orientation, never its
// position, so it can't have that bug by construction.
export function Skybox({ url, visible }: { url: string; visible: boolean }) {
  const texture = useTexture(url);
  const textureRef = useRef(texture);
  const scene = useThree((state) => state.scene);
  const sceneRef = useRef(scene);

  useEffect(() => {
    textureRef.current.mapping = EquirectangularReflectionMapping;
    textureRef.current.colorSpace = SRGBColorSpace;
    textureRef.current.needsUpdate = true;
  }, []);

  // null falls back to the renderer's clear color (the same black used via
  // <color attach="background"> while this texture loads), so hiding the
  // skybox doesn't need a second texture or an extra mesh.
  useEffect(() => {
    sceneRef.current.background = visible ? textureRef.current : null;
  }, [visible]);

  return null;
}
