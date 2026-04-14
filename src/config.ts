// Edition configuration — set by VITE_EDITION env var at build time.
// "community" = open source, BYOK, local-only storage
// "paid" = hosted service with auth, cloud storage, billing

export const EDITION = (import.meta.env.VITE_EDITION as string) || 'community';

export const isPaid = EDITION === 'paid';
export const isCommunity = EDITION === 'community';

export const features = {
  auth: isPaid,
  cloudStorage: isPaid,
  serverLLM: isPaid,       // LLM calls go through server (owner's key)
  byok: isCommunity,       // User provides their own API key
  billing: isPaid,
  sharing: isPaid,
  autoSave: isPaid,
};
