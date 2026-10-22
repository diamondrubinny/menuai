/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, useRef } from 'react';
import { useFeedback } from '../store/feedbackStore';
import { useT } from '../i18n/ui';

/** Visible toasts + a polite live region for screen readers. */
export function Toasts() {
  const toasts = useFeedback((s) => s.toasts);
  const dismiss = useFeedback((s) => s.dismiss);
  const { t } = useT();
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span>{toast.message}</span>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={() => dismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Modal confirmation built on the native <dialog> (focus trap + Esc for free). */
export function ConfirmHost() {
  const request = useFeedback((s) => s.confirmRequest);
  const settle = useFeedback((s) => s.settleConfirm);
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-message"
      onClose={() => settle(false)}
      onCancel={() => settle(false)}
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); settle(true); }}>
        <p id="confirm-message">{request?.message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => settle(false)} autoFocus>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-danger">
            {request?.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
