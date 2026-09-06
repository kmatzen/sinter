import * as THREE from 'three';
import type { BBox, Vec3 } from '../worker/sdf/types';

export type StandardView = 'isometric' | 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

const DIRECTIONS: Record<StandardView, Vec3> = {
  isometric: [1, 0.8, 1],
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

const UPS: Record<StandardView, Vec3> = {
  isometric: [0, 1, 0],
  front: [0, 1, 0],
  back: [0, 1, 0],
  right: [0, 1, 0],
  left: [0, 1, 0],
  // Deliberate roll convention: +Z is screen-down from above and screen-up
  // from below. Fixed vectors avoid OrbitControls inheriting arbitrary roll.
  top: [0, 0, -1],
  bottom: [0, 0, 1],
};

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  distance: number;
}

/** Exact, deterministic pose that frames an AABB in a perspective camera. */
export function standardViewPose(bounds: BBox, view: StandardView, verticalFovDegrees: number): CameraPose {
  const center = new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
  const diagonal = new THREE.Vector3(...bounds.min).distanceTo(new THREE.Vector3(...bounds.max));
  const radius = Math.max(diagonal / 2, 0.05);
  const fov = Math.max(1, Math.min(179, verticalFovDegrees)) * Math.PI / 180;
  const distance = radius / Math.sin(fov / 2);
  const direction = new THREE.Vector3(...DIRECTIONS[view]).normalize();
  const position = center.clone().addScaledVector(direction, distance);
  return {
    position: position.toArray() as Vec3,
    target: center.toArray() as Vec3,
    up: [...UPS[view]],
    distance,
  };
}
