// Shape of a project's content file (stored in Drive or as a Gist).
// Project NAME and timestamps live in the provider's file metadata
// (Drive `name` / Gist `description`) so the list view never needs
// to read file bodies.
export interface ProjectFileBody {
  version: 1;
  thumbnail: string | null;
  tree: unknown;
}

export interface ProjectMeta {
  externalId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageProvider {
  list(token: string): Promise<ProjectMeta[]>;
  read(token: string | null, externalId: string): Promise<ProjectFileBody>;
  create(token: string, name: string, body: ProjectFileBody): Promise<{ externalId: string }>;
  update(token: string, externalId: string, body: ProjectFileBody): Promise<void>;
  rename(token: string, externalId: string, name: string): Promise<void>;
  delete(token: string, externalId: string): Promise<void>;
  /** Toggle public read access. Gists are always URL-accessible so this is a no-op there. */
  setPublic(token: string, externalId: string, isPublic: boolean): Promise<void>;
  isPublic(token: string, externalId: string): Promise<boolean>;
}

export type ProviderName = 'google' | 'github';
