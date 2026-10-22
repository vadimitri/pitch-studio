// ?debug=1 overlay (face box, gaze, fps). Loaded lazily so the debug code never ships in the main path.
import { lazy, Suspense } from "react";
import { useStore } from "../lib/store";
import { engineState, getVision } from "./engine";

const VisionDebug = lazy(() => import("../lib/vision/VisionDebug").then((m) => ({ default: m.VisionDebug })));

export function VisionDebugMount({ video }: { video: HTMLVideoElement }) {
  const { visionReady } = useStore(engineState);
  const vision = visionReady ? getVision() : null;
  if (!vision) return null;
  return (
    <div className="debug-overlay">
      <Suspense fallback={null}>
        <VisionDebug vision={vision} video={video} />
      </Suspense>
    </div>
  );
}
