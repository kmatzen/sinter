import { create } from 'zustand';

interface ModalState {
  // Confirm dialog
  confirmVisible: boolean;
  confirmMessage: string;
  confirmAction: (() => void) | null;

  // Alert/toast
  toastMessage: string | null;

  showConfirm: (message: string, onConfirm: () => void) => void;
  hideConfirm: () => void;
  showToast: (message: string, duration?: number) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useModalStore = create<ModalState>((set) => ({
  confirmVisible: false,
  confirmMessage: '',
  confirmAction: null,
  toastMessage: null,

  showConfirm: (message, onConfirm) => set({
    confirmVisible: true,
    confirmMessage: message,
    confirmAction: onConfirm,
  }),

  hideConfirm: () => set({
    confirmVisible: false,
    confirmMessage: '',
    confirmAction: null,
  }),

  showToast: (message, duration = 3000) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: message });
    toastTimer = setTimeout(() => set({ toastMessage: null }), duration);
  },
}));
