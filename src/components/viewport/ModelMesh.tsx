import { useMemo } from 'react';
import * as THREE from 'three';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { useThree } from '@react-three/fiber';

function thicknessToColor(t: number): [number, number, number] {
  const norm = Math.max(0, Math.min(1, (t - 0.5) / 5));
  if (norm < 0.25) return [1, norm * 4, 0];
  if (norm < 0.5) return [1 - (norm - 0.25) * 4, 1, 0];
  if (norm < 0.75) return [0, 1, (norm - 0.5) * 4];
  return [0, 1 - (norm - 0.75) * 4, 1];
}

export function ModelMesh() {
  const mesh = useModelerStore((s) => s.mesh);
  const clipAxis = useViewportStore((s) => s.clipAxis);
  const clipPosition = useViewportStore((s) => s.clipPosition);
  const clipEnabled = useViewportStore((s) => s.clipEnabled);
  const xray = useViewportStore((s) => s.xray);
  const heatmap = useViewportStore((s) => s.heatmap);

  const { gl } = useThree();
  gl.localClippingEnabled = clipEnabled;

  const geometry = useMemo(() => {
    if (!mesh || mesh.positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    if (mesh.thickness) {
      const colors = new Float32Array(mesh.positions.length);
      const numVerts = mesh.thickness.length;
      for (let i = 0; i < numVerts; i++) {
        const [r, g, b] = thicknessToColor(mesh.thickness[i]);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    return geo;
  }, [mesh]);

  const clippingPlanes = useMemo(() => {
    if (!clipEnabled) return [];
    const normals: Record<string, THREE.Vector3> = {
      x: new THREE.Vector3(-1, 0, 0),
      y: new THREE.Vector3(0, -1, 0),
      z: new THREE.Vector3(0, 0, -1),
    };
    return [new THREE.Plane(normals[clipAxis] || normals.y, clipPosition)];
  }, [clipEnabled, clipAxis, clipPosition]);

  // Stencil pass materials
  const stencilBackMat = useMemo(() => new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    clippingPlanes,
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.IncrementWrapStencilOp,
    stencilZPass: THREE.IncrementWrapStencilOp,
  }), [clippingPlanes]);

  const stencilFrontMat = useMemo(() => new THREE.MeshBasicMaterial({
    side: THREE.FrontSide,
    clippingPlanes,
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.DecrementWrapStencilOp,
    stencilZPass: THREE.DecrementWrapStencilOp,
  }), [clippingPlanes]);

  const capMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#D4A574',
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  }), []);

  const mainMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: heatmap ? '#ffffff' : '#6B8DD6',
    vertexColors: heatmap,
    metalness: heatmap ? 0 : 0.1,
    roughness: heatmap ? 0.8 : 0.6,
    side: THREE.DoubleSide,
    clippingPlanes,
    clipShadows: true,
    transparent: xray,
    opacity: xray ? 0.3 : 1,
    depthWrite: !xray,
  }), [heatmap, xray, clippingPlanes]);

  const capPosition = useMemo((): [number, number, number] => {
    switch (clipAxis) {
      case 'x': return [clipPosition, 0, 0];
      case 'z': return [0, 0, clipPosition];
      default: return [0, clipPosition, 0];
    }
  }, [clipAxis, clipPosition]);

  const capRotation = useMemo((): [number, number, number] => {
    switch (clipAxis) {
      case 'x': return [0, Math.PI / 2, 0];
      case 'z': return [Math.PI / 2, 0, 0];
      default: return [Math.PI / 2, 0, 0];
    }
  }, [clipAxis]);

  if (!geometry) return null;

  if (!clipEnabled) {
    return (
      <>
        <mesh geometry={geometry} material={mainMat} />
        {xray && (
          <mesh geometry={geometry}>
            <meshBasicMaterial color="#6B8DD6" wireframe transparent opacity={0.5} />
          </mesh>
        )}
      </>
    );
  }

  return (
    <>
      <mesh geometry={geometry} material={stencilBackMat} renderOrder={1} />
      <mesh geometry={geometry} material={stencilFrontMat} renderOrder={2} />
      <mesh position={capPosition} rotation={capRotation} material={capMat} renderOrder={3}>
        <planeGeometry args={[500, 500]} />
      </mesh>
      <mesh geometry={geometry} material={mainMat} renderOrder={4} />
    </>
  );
}
