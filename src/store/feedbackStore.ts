import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

interface FeedbackState {
  toasts: Toast[];
  confirmRequest: ConfirmRequest | null;
  notify: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
  confirm: (message: string, confirmLabel: string) => Promise<boolean>;
  settleConfirm: (ok: boolean) => void;
}

let nextId = 1;

export const useFeedback = create<FeedbackState>((set, get) => ({
  toasts: [],
  confirmRequest: null,
  notify: (message, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 9000 : 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  confirm: (message, confirmLabel) =>
    new Promise<boolean>((resolve) => {
      get().confirmRequest?.resolve(false);
      set({ confirmRequest: { message, confirmLabel, resolve } });
    }),
  settleConfirm: (ok) => {
    const req = get().confirmRequest;
    if (!req) return;
    set({ confirmRequest: null });
    req.resolve(ok);
  },
}));
