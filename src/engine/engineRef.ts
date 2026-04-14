import type { ThreeEngine } from './ThreeEngine';

/** Global reference to the active ThreeEngine instance, set by Viewport */
let _engine: ThreeEngine | null = null;

export function setEngineRef(engine: ThreeEngine | null) {
  _engine = engine;
}

export function getEngineRef(): ThreeEngine | null {
  return _engine;
}
