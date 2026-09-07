import type { NamedParameter, SDFNodeUI } from './operations';

/** Portable, copy-on-insert component shared by personal and project libraries. */
export interface ReusableComponent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  thumbnail: string;
  node: SDFNodeUI;
  parameters: NamedParameter[];
  createdAt: string;
  updatedAt: string;
}
