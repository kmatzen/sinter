import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { ModelMesh } from './ModelMesh';
import { Grid } from './Grid';
import { ViewportCameraController } from './ViewportControls';
import { ViewportToolbar } from './ViewportToolbar';
import { DimensionsOverlay } from './DimensionsOverlay';
import { ClipPlaneIndicator } from './ClipPlaneIndicator';
import { useModelerStore } from '../../store/modelerStore';

export function Viewport() {
  const evaluating = useModelerStore((s) => s.evaluating);
  const error = useModelerStore((s) => s.error);

  return (
    <div className="flex-1 relative min-w-0">
      <Canvas camera={{ position: [100, 80, 100], fov: 50 }} gl={{ stencil: true }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[50, 100, 50]} intensity={0.8} castShadow />
        <directionalLight position={[-30, 40, -50]} intensity={0.3} />
        <ModelMesh />
        <Grid />
        <DimensionsOverlay />
        <ClipPlaneIndicator />
        <OrbitControls makeDefault />
        <ViewportCameraController />
        <Environment preset="studio" />
      </Canvas>

      <ViewportToolbar />

      {evaluating && (
        <div className="absolute top-3 left-3 bg-zinc-800/80 px-3 py-1.5 rounded text-sm text-zinc-300">
          Evaluating...
        </div>
      )}
      {error && (
        <div className="absolute bottom-3 left-3 right-60 bg-red-900/90 px-3 py-2 rounded text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
