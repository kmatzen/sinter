export type ViewProjection = 'perspective' | 'orthographic';

export interface NamedProjectView {
  id: string;
  name: string;
  createdAt: string;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  projection: ViewProjection;
  /** Visible world-space height at the orbit target. */
  verticalSpan: number;
  clipping: {
    enabled: boolean;
    axis: 'x' | 'y' | 'z';
    position: number;
    flip: boolean;
  };
}

/**
 * A camera needs two independent directions to define its orientation.  A
 * non-zero up vector that is parallel (or almost parallel) to the sight line
 * still leaves camera roll undefined, which makes `lookAt` unstable.
 */
export function hasValidCameraBasis(
  position: [number, number, number],
  target: [number, number, number],
  up: [number, number, number],
  minimumSine = 1e-6,
): boolean {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const directionLength = Math.hypot(dx, dy, dz);
  const upLength = Math.hypot(up[0], up[1], up[2]);
  if (!Number.isFinite(directionLength) || !Number.isFinite(upLength) || directionLength === 0 || upLength === 0) return false;
  const cx = dy * up[2] - dz * up[1];
  const cy = dz * up[0] - dx * up[2];
  const cz = dx * up[1] - dy * up[0];
  return Math.hypot(cx, cy, cz) / (directionLength * upLength) >= minimumSine;
}
