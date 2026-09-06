import { readLocalBackupJSON } from '../../store/localPersist';
import { useModelerStore } from '../../store/modelerStore';

export interface RecoveryFile {
  json: string;
  filename: string;
  source: 'working document' | 'last evaluated document' | 'browser backup';
}

function validRecoveryJSON(json: string): boolean {
  try {
    const value = JSON.parse(json);
    return !!value && typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, 'tree');
  } catch {
    return false;
  }
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return `${cleaned || 'sinter-recovery'}.json`;
}

/** Return the newest serializable document without mutating any recovery slot. */
export async function buildRecoveryFile(): Promise<RecoveryFile | null> {
  const state = useModelerStore.getState();
  try {
    const json = state.toJSON();
    if (validRecoveryJSON(json)) {
      return { json, filename: safeFilename(`${state.projectName}-recovery`), source: 'working document' };
    }
  } catch { /* fall through to an independently known-good revision */ }

  if (state.lastValidTree) {
    try {
      const json = JSON.stringify({ projectName: state.projectName, tree: state.lastValidTree }, null, 2);
      if (validRecoveryJSON(json)) {
        return { json, filename: safeFilename(`${state.projectName}-last-valid`), source: 'last evaluated document' };
      }
    } catch { /* fall through to durable browser recovery */ }
  }

  const json = await readLocalBackupJSON();
  if (!json || !validRecoveryJSON(json)) return null;
  let name = 'sinter-recovery';
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.projectName === 'string') name = `${parsed.projectName}-backup`;
  } catch { /* validRecoveryJSON already handled this */ }
  return { json, filename: safeFilename(name), source: 'browser backup' };
}

function errorCategory(error: Error): string {
  const text = `${error.name} ${error.message}`.toLowerCase();
  if (/worker|webgl|shader|geometry|sdf/.test(text)) return 'geometry-worker';
  if (/indexeddb|quota|storage|persist/.test(text)) return 'browser-storage';
  if (/fetch|network|offline|timeout/.test(text)) return 'network';
  if (/render|react|component/.test(text)) return 'render';
  return 'application';
}

function safeFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack.split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 20)
    .map((line) => line
      .replace(/(https?:\/\/[^\s?#)]+)[^\s)]*/g, '$1')
      .replace(/[A-Za-z0-9_+\/-]{80,}={0,2}/g, '[redacted]')
      .slice(0, 300));
}

function storageAvailable(kind: 'localStorage' | 'sessionStorage'): boolean {
  try { return typeof window[kind] !== 'undefined'; } catch { return false; }
}

/** Deliberately excludes raw messages, state, URLs with queries, and user data. */
export function buildDiagnosticReport(error: Error, componentStack = ''): string {
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: import.meta.env.PACKAGE_VERSION || 'development',
    page: typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`,
    error: {
      category: errorCategory(error),
      name: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error',
      frames: safeFrames(error.stack),
      componentFrames: safeFrames(componentStack),
    },
    capabilities: {
      worker: typeof Worker !== 'undefined',
      indexedDB: typeof indexedDB !== 'undefined',
      webgl2: typeof WebGL2RenderingContext !== 'undefined',
      localStorage: storageAvailable('localStorage'),
      sessionStorage: storageAvailable('sessionStorage'),
    },
  };
  return JSON.stringify(report, null, 2);
}
