import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  provider: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  checked: boolean;

  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  checked: false,

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        set({ user, loading: false, checked: true });
      } else {
        set({ user: null, loading: false, checked: true });
      }
    } catch {
      set({ user: null, loading: false, checked: true });
    }
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    set({ user: null });
    window.location.href = '/';
  },
}));
