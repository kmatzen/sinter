import { useMemo } from 'react';
import * as THREE from 'three';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { Html } from '@react-three/drei';

export function DimensionsOverlay() {
  const mesh = useModelerStore((s) => s.mesh);
  const showDimensions = useViewportStore((s) => s.showDimensions);

  const bbox = useMemo(() => {
    if (!mesh || mesh.positions.length === 0) return null;
    const box = new THREE.Box3();
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      box.expandByPoint(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
    }
    return box;
  }, [mesh]);

  if (!showDimensions || !bbox) return null;

  const min = bbox.min;
  const max = bbox.max;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const wx = size.x.toFixed(1);
  const wy = size.y.toFixed(1);
  const wz = size.z.toFixed(1);

  return (
    <group>
      {/* Bounding box wireframe */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(size.x, size.y, size.z)]} />
        <lineBasicMaterial color="#ffffff" transparent opacity={0.3} />
      </lineSegments>
      <group position={[(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2]}>
        {/* X dimension label */}
        <Html position={[0, -size.y / 2 - 3, 0]} center>
          <div className="text-[10px] text-blue-300 bg-zinc-900/80 px-1 rounded whitespace-nowrap">
            {wx}mm
          </div>
        </Html>
        {/* Y dimension label */}
        <Html position={[size.x / 2 + 3, 0, 0]} center>
          <div className="text-[10px] text-green-300 bg-zinc-900/80 px-1 rounded whitespace-nowrap">
            {wy}mm
          </div>
        </Html>
        {/* Z dimension label */}
        <Html position={[0, 0, size.z / 2 + 3]} center>
          <div className="text-[10px] text-red-300 bg-zinc-900/80 px-1 rounded whitespace-nowrap">
            {wz}mm
          </div>
        </Html>
      </group>
    </group>
  );
}
