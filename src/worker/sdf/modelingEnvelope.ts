import { MODEL_SPATIAL_LIMIT_MM } from '../../types/modelingEnvelope';
import { computeBounds } from './bounds';
import type { SDFNode } from './types';

/** Smallest physical feature the editor promises to preserve. */
export const MIN_MODEL_FEATURE_MM = 0.1;
/** Conservative condition-number ceiling for composed non-uniform scales. */
export const MAX_MODEL_SCALE_RATIO = 1_000;

export class ModelingEnvelopeError extends Error {
  constructor(message: string) {
    super(`Model is outside the supported modeling envelope: ${message}`);
    this.name = 'ModelingEnvelopeError';
  }
}

function requireFeature(value: number, scale: number, description: string): void {
  const effective = Math.abs(value) * scale;
  if (effective + Number.EPSILON < MIN_MODEL_FEATURE_MM) {
    throw new ModelingEnvelopeError(
      `${description} resolves to ${effective.toPrecision(4)} mm; ` +
      `increase it to at least ${MIN_MODEL_FEATURE_MM} mm after scaling`,
    );
  }
}

/**
 * Validate properties that only become unsafe after operations compose.
 * Per-node schemas cannot see a small primitive under several scales, or a
 * pattern whose individually valid spacing pushes its last copy out of range.
 */
export function validateModelingEnvelope(root: SDFNode): void {
  const bounds = computeBounds(root);
  for (const value of [...bounds.min, ...bounds.max]) {
    if (!Number.isFinite(value) || Math.abs(value) > MODEL_SPATIAL_LIMIT_MM) {
      throw new ModelingEnvelopeError(
        `resolved geometry must stay within ±${MODEL_SPATIAL_LIMIT_MM} mm on every axis`,
      );
    }
  }

  const visit = (node: SDFNode, scale: number, scaleRatio: number): void => {
    switch (node.kind) {
      case 'box':
        requireFeature(Math.min(...node.size), scale, 'box dimension'); return;
      case 'sphere':
        requireFeature(node.radius, scale, 'sphere radius'); return;
      case 'cylinder':
        requireFeature(Math.min(node.radius, node.height), scale, 'cylinder dimension'); return;
      case 'torus':
        requireFeature(node.minor, scale, 'torus tube radius'); return;
      case 'cone':
        requireFeature(Math.min(node.radius, node.height), scale, 'cone dimension'); return;
      case 'capsule':
        requireFeature(Math.min(node.radius, node.height), scale, 'capsule dimension'); return;
      case 'ellipsoid':
        requireFeature(Math.min(...node.size), scale, 'ellipsoid dimension'); return;
      case 'text':
        requireFeature(Math.min(node.size, node.depth), scale, 'text dimension'); return;
      case 'shell':
        requireFeature(node.thickness, scale, 'shell thickness');
        visit(node.child, scale, scaleRatio); return;
      case 'offset':
        if (node.distance !== 0) requireFeature(node.distance, scale, 'offset distance');
        visit(node.child, scale, scaleRatio); return;
      case 'round':
        if (node.radius !== 0) requireFeature(node.radius, scale, 'round radius');
        visit(node.child, scale, scaleRatio); return;
      case 'transform': {
        const lo = Math.min(Math.abs(node.sx), Math.abs(node.sy), Math.abs(node.sz));
        const hi = Math.max(Math.abs(node.sx), Math.abs(node.sy), Math.abs(node.sz));
        const nextRatio = scaleRatio * hi / lo;
        if (!Number.isFinite(nextRatio) || nextRatio > MAX_MODEL_SCALE_RATIO) {
          throw new ModelingEnvelopeError(
            `composed scale ratio ${nextRatio.toPrecision(4)}:1 exceeds ${MAX_MODEL_SCALE_RATIO}:1`,
          );
        }
        visit(node.child, scale * lo, nextRatio); return;
      }
      case 'union':
      case 'subtract':
      case 'intersect':
        visit(node.a, scale, scaleRatio);
        visit(node.b, scale, scaleRatio);
        return;
      case 'mirror':
      case 'linearPattern':
      case 'circularPattern':
        visit(node.child, scale, scaleRatio); return;
      case 'mesh':
      case 'halfSpace':
      case '_far':
        return;
    }
  };

  visit(root, 1, 1);
}
