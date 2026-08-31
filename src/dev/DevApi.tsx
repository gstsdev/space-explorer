import { useEffect } from "react";
import type { RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { Object3D } from "three";
import { simulation } from "../simulation";
import { J2000_EPOCH_MS, secondsSinceJ2000 } from "../astronomy";

// Dev-only console API — installs `window.spaceExplorer` for driving the
// simulation from DevTools while debugging (jump to a date, focus a body,
// change playback speed). Mounted only behind `import.meta.env.DEV` in
// App.tsx, so this module is tree-shaken from production builds; see
// EclipseShadowDevTools' own comment for the same pattern.
//
// Rendered inside <Canvas> so useThree() can reach the live scene graph to
// resolve a body id (userData.bodyId, stamped in Planet/Moon/Sun) to its
// Object3D for focusing.
export function DevApi({
  focusTarget,
  onSelect,
}: {
  // App's camera focus ref — CameraRig reads .current every frame and
  // dollies to whatever Object3D it points at (see CameraRig).
  focusTarget: RefObject<Object3D | null>;
  // App's setSelectedId — keeps the DOM UI (StatsPanel, labels) in sync
  // with the focused body.
  onSelect: (id: string | null) => void;
}) {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const bodies = () => {
      const found: { id: string; object: Object3D }[] = [];
      scene.traverse((object) => {
        if (typeof object.userData.bodyId === "string") {
          found.push({ id: object.userData.bodyId, object });
        }
      });
      return found;
    };

    // Accepts a Date, an ms-epoch number, a large seconds-since-J2000 number,
    // or any string `new Date()` understands (ISO 8601 recommended).
    const toSecondsSinceJ2000 = (value: Date | number | string): number => {
      if (value instanceof Date) return secondsSinceJ2000(value);
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`Bad time value: ${value}`);
        // Heuristic: anything past ~1973 in ms-epoch terms is treated as an
        // absolute timestamp; smaller magnitudes are seconds-since-J2000.
        return Math.abs(value) > 1e11 ? secondsSinceJ2000(new Date(value)) : value;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error(`Unparseable date: ${value}`);
      return secondsSinceJ2000(parsed);
    };

    const api = {
      /** Current simulation instant as a Date. */
      get time() {
        return new Date(J2000_EPOCH_MS + simulation.time * 1000);
      },
      /** Jump the simulation clock. Returns the new instant. */
      setTime(value: Date | number | string) {
        simulation.time = toSecondsSinceJ2000(value);
        return this.time;
      },
      /** Current playback multiplier (1 = real time). */
      get speed() {
        return simulation.speed;
      },
      /** Set the playback multiplier. */
      setSpeed(multiplier: number) {
        simulation.speed = multiplier;
        return simulation.speed;
      },
      /** Freeze the clock (speed 0). */
      pause() {
        simulation.speed = 0;
      },
      /** Every selectable body id currently in the scene. */
      list() {
        return bodies().map((body) => body.id);
      },
      /** Focus the camera on a body by id (or pass null to clear focus). */
      select(id: string | null) {
        if (id === null) {
          focusTarget.current = null;
          onSelect(null);
          return null;
        }
        const match = bodies().find((body) => body.id === id);
        if (!match) {
          throw new Error(`No body "${id}". Available: ${bodies().map((b) => b.id).join(", ")}`);
        }
        focusTarget.current = match.object;
        onSelect(id);
        return id;
      },
    };

    (window as unknown as Record<string, unknown>).spaceExplorer = api;
    console.info(
      "[dev] window.spaceExplorer ready — setTime(date), select(id), list(), setSpeed(x), pause()",
    );

    return () => {
      delete (window as unknown as Record<string, unknown>).spaceExplorer;
    };
  }, [scene, focusTarget, onSelect]);

  return null;
}
