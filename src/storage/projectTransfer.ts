export interface LocalProjectDestination {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
  clear(): Promise<void>;
}

export type LocalMoveResult =
  | { status: 'moved' }
  | { status: 'copied'; deleteError: Error };

export class LocalProjectConflictError extends Error {
  constructor() {
    super('A browser project already exists');
    this.name = 'LocalProjectConflictError';
  }
}

/** Serialize provider/local input as one complete, validated v2 document. */
export function encodeTransferredProject(projectName: string, input: unknown, pretty = false): string {
  const project = decodeProjectDocument(input, projectName || 'Untitled');
  return JSON.stringify({
    version: 2,
    projectName: projectName || project.projectName || 'Untitled',
    thumbnail: project.thumbnail,
    tree: project.tree,
    checkpoints: project.checkpoints,
    parameters: project.parameters,
    views: project.views,
    measurements: project.measurements,
  }, null, pretty ? 2 : undefined);
}

/**
 * Move a cloud document through a verified local commit before source delete.
 * The operation is restartable: a repeated call sees the committed local copy
 * as a conflict, and a failed source delete deliberately leaves both copies.
 */
export async function moveCloudProjectToLocal(options: {
  destination: LocalProjectDestination;
  projectName: string;
  readSource: () => Promise<unknown>;
  deleteSource: () => Promise<void>;
  replaceExisting?: boolean;
}): Promise<LocalMoveResult> {
  const { destination } = options;
  const previous = await destination.read();
  if (previous !== null && !options.replaceExisting) throw new LocalProjectConflictError();

  // Read/auth failures happen before any destination or source mutation.
  const body = await options.readSource();
  const encoded = encodeTransferredProject(options.projectName, body);

  try {
    await destination.write(encoded);
    const readBack = await destination.read();
    if (readBack !== encoded) throw new Error('Browser storage verification failed');
    const decoded = JSON.parse(readBack);
    if (decoded.projectName !== options.projectName || !Object.prototype.hasOwnProperty.call(decoded, 'tree')) {
      throw new Error('Browser storage verification failed');
    }
  } catch (error) {
    // Restore the destination exactly; the cloud source has not been touched.
    try {
      if (previous === null) await destination.clear();
      else await destination.write(previous);
    } catch { /* retain the primary storage error */ }
    throw error;
  }

  try {
    await options.deleteSource();
    return { status: 'moved' };
  } catch (error) {
    return { status: 'copied', deleteError: error instanceof Error ? error : new Error(String(error)) };
  }
}
import { decodeProjectDocument } from '../types/documentDecoder';
