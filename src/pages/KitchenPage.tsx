/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Kitchen screen (#/kitchen): accepted orders waiting to be made, oldest first, in large type, for a
 * tablet on the kitchen wall. Editors and above (enforced by the server on every call).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isNoServer, type ApiUser } from '../api/client';
import { listOrders, markReady, type StaffOrder } from '../api/orders';
import { playChime, saveSoundPreference, soundPreference } from '../core/chime';
import { useFeedback } from '../store/feedbackStore';
import { useT } from '../i18n/ui';

const REFRESH_MS = 5_000;
/** After this long an order is flagged in text (not by color alone). */
const LATE_MINUTES = 15;

type Gate = { kind: 'loading' } | { kind: 'signedOut' } | { kind: 'noServer' } | { kind: 'staffOnly' } | { kind: 'ready'; me: ApiUser };

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export function KitchenPage() {
  const { t, dir } = useT();
  const notify = useFeedback((s) => s.notify);
  const heading = useRef<HTMLHeadingElement>(null);
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [orders, setOrders] = useState<StaffOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sound, setSound] = useState(soundPreference);
  const [announce, setAnnounce] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    heading.current?.focus();
    void (async () => {
      const me = await api<{ user: ApiUser }>('/me');
      if (!me.ok) return setGate(isNoServer(me.status, me.error) ? { kind: 'noServer' } : { kind: 'signedOut' });
      if (me.data.user.role === 'viewer') return setGate({ kind: 'staffOnly' });
      setGate({ kind: 'ready', me: me.data.user });
    })();
  }, []);

  const load = useCallback(async () => {
    const r = await listOrders('kitchen');
    setFailed(!r.ok);
    if (!r.ok) return;
    setOrders(r.data.orders);
    setNow(Date.now());
    const ids = new Set(r.data.orders.map((o) => o.id));
    const fresh = known.current ? [...ids].filter((id) => !known.current!.has(id)) : [];
    if (fresh.length > 0) {
      setAnnounce(t('kitCount', { n: ids.size }));
      if (soundPreference()) playChime();
    }
    known.current = ids;
  }, [t]);

  useEffect(() => {
    if (gate.kind !== 'ready') return;
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [gate.kind, load]);

  // Keep a kitchen tablet's screen on while this page is open (where the browser allows it).
  useEffect(() => {
    if (gate.kind !== 'ready') return;
    let lock: WakeLockSentinelLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    const acquire = () => {
      if (document.visibilityState !== 'visible' || !nav.wakeLock) return;
      nav.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => { /* not allowed: fine */ });
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [gate.kind]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    saveSoundPreference(next);
    if (next) playChime(); // also unlocks audio in the browser (it needs a tap first)
  };

  const ready = async (o: StaffOrder) => {
    setBusy(o.id);
    const r = await markReady(o.id);
    setBusy(null);
    if (!r.ok) notify(t(r.error === 'order_not_accepted' ? 'ordErrNotAccepted' : r.status === 429 ? 'loginTooMany' : 'payErrFailed'), 'error');
    else notify(t('kitMarked'), 'success');
    void load();
  };

  const minutes = (o: StaffOrder) => Math.max(0, Math.floor((now - new Date(o.decidedAt ?? o.createdAt).getTime()) / 60_000));

  return (
    <main className="doc-page kitchen-page" id="main">
      <p><a href="#/payments"><span aria-hidden="true">{dir === 'rtl' ? '→' : '←'}</span> {t('kitBack')}</a></p>
      <div className="kitchen-head">
        <h1 ref={heading} tabIndex={-1}>{t('kitTitle')}</h1>
        {gate.kind === 'ready' && (
          <button type="button" className={`btn btn-sm${sound ? ' btn-primary' : ''}`} aria-pressed={sound} onClick={toggleSound}>
            <span aria-hidden="true">{sound ? '🔔' : '🔕'}</span> {t('ordSound')}
          </button>
        )}
      </div>
      <div role="status" aria-live="polite">
        {gate.kind === 'loading' && <p className="hint">{t('cloudChecking')}</p>}
        {gate.kind === 'noServer' && <p className="notice notice-error">{t('cloudNoServer')}</p>}
        {gate.kind === 'staffOnly' && <p className="notice notice-error">{t('payStaffOnly')}</p>}
        <span className="visually-hidden">{announce}</span>
      </div>
      {gate.kind === 'signedOut' && (
        <>
          <p>{t('cloudSignedOut')}</p>
          <p><a className="btn btn-primary" href="#/login">{t('cloudSignIn')}</a></p>
        </>
      )}
      {gate.kind === 'ready' && (
        <>
          <p className="hint">{t('kitIntro')}</p>
          {failed && <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>}
          {orders === null && !failed && <p className="hint">{t('cloudLoading')}</p>}
          {orders?.length === 0 && <p className="kitchen-empty">{t('kitNone')}</p>}
          <ul className="kitchen-orders" aria-label={t('kitCount', { n: orders?.length ?? 0 })}>
            {orders?.map((o) => {
              const m = minutes(o);
              const late = m >= LATE_MINUTES;
              return (
                <li key={o.id} className={`kitchen-card${late ? ' is-late' : ''}`} aria-busy={busy === o.id}>
                  <div className="kitchen-card-head">
                    <h2 id={`k-${o.id}`}>{t('payTable')} {o.tableLabel}</h2>
                    <span className="kitchen-time">
                      <span aria-hidden="true">⏱ </span>{t('kitWaiting', { n: m })}
                      {late && <strong className="kitchen-late"> · ⚠ {t('kitLate')}</strong>}
                    </span>
                  </div>
                  <ul className="kitchen-lines">
                    {o.lines.map((l, i) => (
                      <li key={i}>
                        <span className="kitchen-qty">{l.qty}×</span> <bdi>{l.name}</bdi>
                        {l.variantLabel && <> · <bdi>{l.variantLabel}</bdi></>}
                        {l.note && <p className="kitchen-note" dir="auto"><span aria-hidden="true">✎ </span>{l.note}</p>}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn btn-primary kitchen-ready" disabled={busy === o.id} aria-describedby={`k-${o.id}`} onClick={() => void ready(o)}>
                    {t('kitReady')}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
