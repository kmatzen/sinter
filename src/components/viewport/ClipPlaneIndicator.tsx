import { useMemo } from 'react';
import * as THREE from 'three';
import { useViewportStore } from '../../store/viewportStore';

const AXIS_COLORS: Record<string, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
};

export function ClipPlaneIndicator() {
  const clipEnabled = useViewportStore((s) => s.clipEnabled);
  const clipAxis = useViewportStore((s) => s.clipAxis);
  const clipPosition = useViewportStore((s) => s.clipPosition);

  const position = useMemo((): [number, number, number] => {
    switch (clipAxis) {
      case 'x': return [clipPosition, 0, 0];
      case 'z': return [0, 0, clipPosition];
      default: return [0, clipPosition, 0];
    }
  }, [clipAxis, clipPosition]);

  const rotation = useMemo((): [number, number, number] => {
    switch (clipAxis) {
      case 'x': return [0, Math.PI / 2, 0];
      case 'z': return [Math.PI / 2, 0, 0];
      default: return [Math.PI / 2, 0, 0];
    }
  }, [clipAxis]);

  const color = AXIS_COLORS[clipAxis] || '#22c55e';

  if (!clipEnabled) return null;

  return (
    <mesh position={position} rotation={rotation} renderOrder={0}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial
        color={color}
        side={THREE.DoubleSide}
        transparent
        opacity={0.06}
        depthWrite={false}
      />
    </mesh>
  );
}
