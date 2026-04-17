import type { ThreeEngine } from './ThreeEngine';

/** Global reference to the active ThreeEngine instance, set by Viewport */
let _engine: ThreeEngine | null = null;

export function setEngineRef(engine: ThreeEngine | null) {
  _engine = engine;
  if (typeof window !== 'undefined') {
    (window as any).__ENGINE_REF__ = engine;
  }
}

export function getEngineRef(): ThreeEngine | null {
  return _engine;
}
