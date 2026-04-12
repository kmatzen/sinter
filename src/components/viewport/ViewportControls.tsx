import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useViewportStore } from '../../store/viewportStore';
import * as THREE from 'three';

const VIEWS: Record<string, { pos: [number, number, number]; up: [number, number, number] }> = {
  front:  { pos: [0, 0, 150],  up: [0, 1, 0] },
  back:   { pos: [0, 0, -150], up: [0, 1, 0] },
  left:   { pos: [-150, 0, 0], up: [0, 1, 0] },
  right:  { pos: [150, 0, 0],  up: [0, 1, 0] },
  top:    { pos: [0, 150, 0],  up: [0, 0, -1] },
  bottom: { pos: [0, -150, 0], up: [0, 0, 1] },
  iso:    { pos: [100, 80, 100], up: [0, 1, 0] },
};

export function ViewportCameraController() {
  const { camera } = useThree();
  const viewRequest = useViewportStore((s) => s.viewRequest);
  const clearViewRequest = useViewportStore((s) => s.clearViewRequest);
  const animating = useRef(false);

  useEffect(() => {
    if (!viewRequest || animating.current) return;
    const view = VIEWS[viewRequest];
    if (!view) { clearViewRequest(); return; }

    animating.current = true;
    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const endPos = new THREE.Vector3(...view.pos);
    const endUp = new THREE.Vector3(...view.up);
    const startTime = performance.now();
    const duration = 400;

    function animate() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const ease = t * (2 - t); // ease-out quad
      camera.position.lerpVectors(startPos, endPos, ease);
      camera.up.lerpVectors(startUp, endUp, ease);
      camera.lookAt(0, 0, 0);
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        animating.current = false;
        clearViewRequest();
      }
    }
    animate();
  }, [viewRequest, camera, clearViewRequest]);

  return null;
}
