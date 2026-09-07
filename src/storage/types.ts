import type { NamedParameter } from '../types/operations';
import type { NamedProjectView } from '../types/view';
import type { PinnedMeasurement } from '../types/measurement';
import type { UnitPreferences } from '../types/units';
import type { ReusableComponent } from '../types/component';
import type { NamedConfiguration } from '../types/configuration';

// Shape of a project's content file (stored in Drive or as a Gist).
// Project NAME and timestamps live in the provider's file metadata
// (Drive `name` / Gist `description`) so the list view never needs
// to read file bodies.
export interface ProjectCheckpoint {
  id: string;
  name: string;
  createdAt: string;
  tree: unknown;
  parameters?: NamedParameter[];
  /** Added after document v2 shipped; absence preserves the current views for legacy checkpoints. */
  views?: NamedProjectView[];
  measurements?: PinnedMeasurement[];
  /** Added after document v2 shipped; absence preserves current project units on restore. */
  units?: UnitPreferences;
  configurations?: NamedConfiguration[];
  activeConfigurationId?: string | null;
}

export interface ProjectFileBody {
  version: 1 | 2;
  thumbnail: string | null;
  tree: unknown;
  checkpoints?: ProjectCheckpoint[];
  parameters?: NamedParameter[];
  views?: NamedProjectView[];
  measurements?: PinnedMeasurement[];
  units?: UnitPreferences;
  /** Components embedded in this project and synced by its storage provider. */
  components?: ReusableComponent[];
  configurations?: NamedConfiguration[];
  activeConfigurationId?: string | null;
}

export interface ProjectReadResult extends ProjectFileBody {
  /** Opaque provider revision used for optimistic concurrency. */
  revision: string;
}

export class StorageConflictError extends Error {
  constructor() {
    super('This cloud project changed elsewhere. Reload it or save your work as a copy.');
    this.name = 'StorageConflictError';
  }
}

export interface ProjectMeta {
  externalId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageProvider {
  list(token: string, signal?: AbortSignal): Promise<ProjectMeta[]>;
  read(token: string | null, externalId: string): Promise<ProjectReadResult>;
  create(token: string, name: string, body: ProjectFileBody): Promise<{ externalId: string; revision: string }>;
  update(token: string, externalId: string, body: ProjectFileBody, expectedRevision: string): Promise<{ revision: string }>;
  rename(token: string, externalId: string, name: string, expectedRevision: string): Promise<{ revision: string }>;
  delete(token: string, externalId: string): Promise<void>;
  /** Toggle public read access. Gists are always URL-accessible so this is a no-op there. */
  setPublic(token: string, externalId: string, isPublic: boolean): Promise<void>;
  isPublic(token: string, externalId: string): Promise<boolean>;
}

export type ProviderName = 'google' | 'github';
