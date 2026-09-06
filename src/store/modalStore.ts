import { create } from 'zustand';

interface ModalState {
  // Confirm dialog
  confirmVisible: boolean;
  confirmMessage: string;
  confirmAction: (() => void) | null;
  confirmLabel: string;
  confirmSecondaryLabel: string | null;
  confirmSecondaryAction: (() => void) | null;

  // Alert/toast
  toastMessage: string | null;

  showConfirm: (message: string, onConfirm: () => void, options?: {
    confirmLabel?: string;
    secondaryLabel?: string;
    onSecondary?: () => void;
  }) => void;
  hideConfirm: () => void;
  showToast: (message: string, duration?: number) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useModalStore = create<ModalState>((set) => ({
  confirmVisible: false,
  confirmMessage: '',
  confirmAction: null,
  confirmLabel: 'Delete',
  confirmSecondaryLabel: null,
  confirmSecondaryAction: null,
  toastMessage: null,

  showConfirm: (message, onConfirm, options) => set({
    confirmVisible: true,
    confirmMessage: message,
    confirmAction: onConfirm,
    confirmLabel: options?.confirmLabel ?? 'Delete',
    confirmSecondaryLabel: options?.secondaryLabel ?? null,
    confirmSecondaryAction: options?.onSecondary ?? null,
  }),

  hideConfirm: () => set({
    confirmVisible: false,
    confirmMessage: '',
    confirmAction: null,
    confirmLabel: 'Delete',
    confirmSecondaryLabel: null,
    confirmSecondaryAction: null,
  }),

  showToast: (message, duration = 3000) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: message });
    toastTimer = setTimeout(() => set({ toastMessage: null }), duration);
  },
}));
