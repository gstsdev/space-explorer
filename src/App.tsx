import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { Object3D } from "three";
import { Scene } from "./Scene";
import { CAMERA_FAR, CameraRig } from "./CameraRig";
import { SimulationClock } from "./simulation";
import { SpeedControl } from "./SpeedControl";
import { StatsPanel } from "./StatsPanel";
import { Skybox } from "./Skybox";
import { ViewControls } from "./ViewControls";
import { SUN_DATA } from "./astronomy";

export default function App() {
  const focusTarget = useRef<Object3D | null>(null);
  // Mirrors focusTarget for the parts of the UI (stats panel, label/orbit
  // highlighting) that need to re-render on selection — focusTarget itself
  // stays a plain ref since CameraRig reads it every frame and doesn't need
  // React to re-render the Canvas tree just because the camera is moving.
  const [selectedId, setSelectedId] = useState<string | null>(SUN_DATA.id);
  const [showOrbits, setShowOrbits] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [showStars, setShowStars] = useState(true);
  const [pictureMode, setPictureMode] = useState(false);

  useEffect(() => {
    if (!pictureMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPictureMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pictureMode]);

  return (
    <>
      {/* near/far span nine orders of magnitude (planet radii up to Neptune's
      orbit, ~4515 units out, in real scale) — logarithmicDepthBuffer avoids
      z-fighting across that range. */}
      <Canvas
        camera={{ position: [0, 2, 5.5], fov: 50, near: 0.001, far: CAMERA_FAR }}
        gl={{ logarithmicDepthBuffer: true }}
      >
        {/* Plain black fallback while the skybox image loads (or if it fails) — */}
        <color attach="background" args={["#000000"]} />
        <ambientLight intensity={0.15} />
        <Suspense fallback={null}>
          <Skybox url="/textures/skybox/milkyway.jpg" visible={showStars} />
        </Suspense>
        <Scene
          selectedId={selectedId}
          showOrbits={showOrbits && !pictureMode}
          showPlaceholders={showPlaceholders && !pictureMode}
          showLabels={!pictureMode}
          onFocus={(object, id) => {
            focusTarget.current = object;
            setSelectedId(id);
          }}
        />
        <CameraRig focusTarget={focusTarget} />
        <SimulationClock />
      </Canvas>
      {!pictureMode && (
        <>
          <SpeedControl />
          <StatsPanel selectedId={selectedId} />
          <ViewControls
            showOrbits={showOrbits}
            onToggleOrbits={() => setShowOrbits((value) => !value)}
            showPlaceholders={showPlaceholders}
            onTogglePlaceholders={() => setShowPlaceholders((value) => !value)}
            showStars={showStars}
            onToggleStars={() => setShowStars((value) => !value)}
            onEnterPictureMode={() => setPictureMode(true)}
          />
        </>
      )}
    </>
  );
}
