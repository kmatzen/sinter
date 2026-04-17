export interface StorageProvider {
  /** Create a new file, return the external ID */
  create(token: string, filename: string, content: string, isPublic: boolean): Promise<{ externalId: string }>;
  /** Read file content by external ID */
  read(token: string, externalId: string): Promise<string>;
  /** Update file content */
  update(token: string, externalId: string, content: string): Promise<void>;
  /** Delete file */
  delete(token: string, externalId: string): Promise<void>;
  /** Set public/private visibility (for sharing) */
  setPublic(token: string, externalId: string, isPublic: boolean): Promise<void>;
  /** Get a public URL that can be read without auth */
  getPublicUrl(externalId: string): string;
}
