import { create } from 'zustand';

const CONSENT_KEY = 'sinter_cookie_consent';

export type ConsentReason = 'signin' | 'local' | 'apikey';

interface ConsentState {
  granted: boolean;
  pendingReason: ConsentReason | null;
  ensure: (reason: ConsentReason) => Promise<boolean>;
  accept: () => void;
  decline: () => void;
}

function readGranted(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'accepted';
  } catch {
    return false;
  }
}

// Module-scoped resolver queue: dedupes concurrent prompts so rapid
// repeated ensureConsent() calls only show one modal but resolve all of them.
const pendingResolvers: Array<(granted: boolean) => void> = [];

export const useConsentStore = create<ConsentState>((set, get) => ({
  granted: readGranted(),
  pendingReason: null,

  ensure: (reason) => {
    if (get().granted) return Promise.resolve(true);
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
      if (!get().pendingReason) set({ pendingReason: reason });
    });
  },

  accept: () => {
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch { /* */ }
    set({ granted: true, pendingReason: null });
    const resolvers = pendingResolvers.splice(0);
    for (const r of resolvers) r(true);
  },

  decline: () => {
    set({ pendingReason: null });
    const resolvers = pendingResolvers.splice(0);
    for (const r of resolvers) r(false);
  },
}));

export function ensureConsent(reason: ConsentReason): Promise<boolean> {
  return useConsentStore.getState().ensure(reason);
}

export function hasConsent(): boolean {
  return useConsentStore.getState().granted;
}
