/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Orders from the menu (Phase 3e): waiters accept them into the table's bill, or reject them. */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { acceptOrder, listOrders, rejectOrder, setOrdering, type StaffOrder } from '../api/orders';
import { formatAgorot } from '../api/payments';
import { useFeedback } from '../store/feedbackStore';
import { useT, type UiKey } from '../i18n/ui';

const REFRESH_MS = 5_000;

const ERRORS: Record<string, UiKey> = {
  order_not_new: 'ordErrNotNew',
  bill_too_large: 'ordErrBillTooLarge',
  payments_not_configured: 'payNotConfigured',
};
const errorKey = (error: string, status: number): UiKey => ERRORS[error] ?? (status === 429 ? 'loginTooMany' : 'payErrFailed');

export function OrdersSection({ isOwner }: { isOwner: boolean }) {
  const { t, lang } = useT();
  const id = useId();
  const notify = useFeedback((s) => s.notify);
  const [view, setView] = useState<'open' | 'recent'>('open');
  const [orders, setOrders] = useState<StaffOrder[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  // Announce only when the number of waiting orders goes up (not on every refresh).
  const [announce, setAnnounce] = useState('');
  const waiting = useRef<number | null>(null);
  const money = (a: number) => formatAgorot(a, lang);

  const load = useCallback(async () => {
    const r = await listOrders(view);
    setFailed(!r.ok);
    if (!r.ok) return;
    setOrders(r.data.orders);
    setEnabled(r.data.enabled);
    const n = r.data.orders.filter((o) => o.status === 'new').length;
    if (view === 'open' && waiting.current !== null && n > waiting.current) setAnnounce(t('ordNewCount', { n }));
    if (view === 'open') waiting.current = n;
  }, [view, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const toggle = async (next: boolean) => {
    setBusy('settings');
    const r = await setOrdering(next);
    setBusy(null);
    if (!r.ok) return notify(t(errorKey(r.error, r.status)), 'error');
    setEnabled(next);
    notify(t('ordSaved'), 'success');
  };

  const accept = async (o: StaffOrder) => {
    setBusy(o.id);
    const r = await acceptOrder(o.id);
    setBusy(null);
    if (!r.ok) {
      notify(t(errorKey(r.error, r.status)), 'error');
    } else {
      notify(t('ordAccepted'), 'success');
    }
    void load();
  };

  const reject = async (o: StaffOrder) => {
    if (!rejecting) return;
    setBusy(o.id);
    const r = await rejectOrder(o.id, rejecting.reason.trim());
    setBusy(null);
    if (!r.ok) {
      notify(t(errorKey(r.error, r.status)), 'error');
    } else {
      setRejecting(null);
      notify(t('ordRejected'), 'success');
    }
    void load();
  };

  return (
    <>
      {isOwner && enabled !== null && (
        <div className="pay-card">
          <label className="pay-check">
            <input type="checkbox" checked={enabled} disabled={busy === 'settings'} onChange={(e) => void toggle(e.target.checked)} aria-describedby={`${id}-hint`} />
            {' '}{t('ordEnable')}
          </label>
          <p className="hint" id={`${id}-hint`}>{t('ordEnableHint')}</p>
        </div>
      )}
      <div className="pay-toolbar">
        <h3 id={`${id}-list`}>{t(view === 'open' ? 'ordOpen' : 'ordRecent')}</h3>
        <div className="button-row">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView(view === 'open' ? 'recent' : 'open')}>
            {t(view === 'open' ? 'ordShowRecent' : 'ordShowOpen')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>↻ {t('payRefresh')}</button>
        </div>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
      {failed && <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>}
      {orders === null && !failed && <p className="hint">{t('cloudLoading')}</p>}
      {orders?.length === 0 && <p className="hint">{t(view === 'open' ? 'ordNone' : 'ordNoneRecent')}</p>}
      <ul className="pay-bills" aria-labelledby={`${id}-list`}>
        {orders?.map((o) => (
          <li key={o.id} className={`pay-card${o.status === 'new' ? ' ord-new' : ''}`} aria-busy={busy === o.id}>
            <div className="pay-bill-head">
              <strong>{t('payTable')} {o.tableLabel}</strong>
              <span>
                <time dateTime={o.createdAt}>{new Date(o.createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</time>
                {' '}
                <span className={`team-badge${o.status === 'rejected' ? ' is-off' : ''}`}>
                  {o.status === 'new' && <span aria-hidden="true">● </span>}{t(`ordStatus_${o.status}` as UiKey)}
                </span>
              </span>
            </div>
            <ul className="ord-lines">
              {o.lines.map((l, i) => (
                <li key={i}>
                  <span className="ord-qty">{l.qty}×</span>{' '}
                  <bdi>{l.name}</bdi>{l.variantLabel && <> · <bdi>{l.variantLabel}</bdi></>}
                  <span className="ord-price">{money(l.unitAgorot * l.qty)}</span>
                  {l.note && <p className="ord-note" dir="auto"><span aria-hidden="true">✎ </span>{l.note}</p>}
                </li>
              ))}
            </ul>
            <p className="ord-total"><strong>{t('ordTotal')}: {money(o.totalAgorot)}</strong></p>
            {o.rejectReason && <p className="hint" dir="auto">{o.rejectReason}</p>}
            {o.status === 'new' && (
              <div className="team-actions pay-actions">
                <button type="button" className="btn btn-sm btn-primary" disabled={busy === o.id} onClick={() => void accept(o)}>{t('ordAccept')}</button>
                {rejecting?.id === o.id ? (
                  <form className="pay-resolve" onSubmit={(e) => { e.preventDefault(); void reject(o); }}>
                    <label className="visually-hidden" htmlFor={`${id}-r-${o.id}`}>{t('ordRejectReason')}</label>
                    <input
                      id={`${id}-r-${o.id}`} type="text" maxLength={140} placeholder={t('ordRejectReason')} value={rejecting.reason} autoFocus
                      onChange={(e) => setRejecting({ id: o.id, reason: e.target.value })}
                    />
                    <button type="submit" className="btn btn-sm" disabled={busy === o.id}>{t('ordRejectDo')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRejecting(null)}>{t('close')}</button>
                  </form>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost btn-danger-text" onClick={() => setRejecting({ id: o.id, reason: '' })}>{t('ordReject')}</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
