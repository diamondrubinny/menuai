/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, useState } from 'react';
import { cloud, useCloud } from '../store/cloudStore';
import { useFeedback } from '../store/feedbackStore';
import { useT, type UiKey } from '../i18n/ui';
import type { CloudMenuSummary, SyncStatus } from '../cloud/sync';
import { Fieldset } from './fields/Fields';

const STATUS_KEY: Record<Exclude<SyncStatus, 'local'>, UiKey> = {
  saved: 'syncSaved',
  saving: 'syncSaving',
  pending: 'syncPending',
  offline: 'syncOffline',
  conflict: 'syncConflict',
  readonly: 'syncReadonly',
  error: 'syncError',
};
const WARN: SyncStatus[] = ['offline', 'conflict', 'error', 'pending'];

const ROLE_KEY = { owner: 'roleOwner', editor: 'roleEditor', viewer: 'roleViewer' } as const;

function useFormatDate() {
  const { lang } = useT();
  return (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  };
}

/** Starts the cloud connection check once the editor is shown (again, e.g. after signing in). */
export function useCloudInit() {
  useEffect(() => {
    void cloud.init();
  }, []);
}

/** Compact sync indicator for the top bar. Only problems are announced to screen readers. */
export function CloudStatus() {
  const { t } = useT();
  const status = useCloud((s) => s.status);
  if (status === 'local') return null;
  const text = t(STATUS_KEY[status]);
  const warn = WARN.includes(status);
  return (
    <>
      <span className={`sync-chip${warn ? ' is-warn' : ''}`} data-status={status}>
        <span aria-hidden="true">{status === 'saved' ? '☁︎✓' : status === 'saving' ? '☁︎…' : '☁︎!'}</span> {text}
      </span>
      <span className="visually-hidden" role="status">{warn ? text : ''}</span>
    </>
  );
}

/** Shown above the panels whenever two devices changed the same menu: the user must pick a side. */
export function CloudConflict() {
  const { t } = useT();
  const conflict = useCloud((s) => s.conflict);
  const confirm = useFeedback((s) => s.confirm);
  const [busy, setBusy] = useState(false);
  const format = useFormatDate();
  if (!conflict) return null;

  const resolve = async (keep: 'mine' | 'theirs') => {
    const ok = await confirm(t(keep === 'mine' ? 'cloudKeepMineConfirm' : 'cloudKeepTheirsConfirm'), t(keep === 'mine' ? 'cloudKeepMine' : 'cloudKeepTheirs'));
    if (!ok) return;
    setBusy(true);
    await cloud.resolveConflict(keep);
    setBusy(false);
  };

  const when = format(conflict.updatedAt);
  const by = conflict.updatedBy ? ` (${conflict.updatedBy}${when ? `, ${when}` : ''})` : when ? ` (${when})` : '';
  return (
    <div className="cloud-conflict" role="alert">
      <p className="cloud-conflict-title">{t('cloudConflictTitle')}</p>
      <p>{t('cloudConflictText', { by })}</p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resolve('theirs')}>{t('cloudKeepTheirs')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void resolve('mine')}>{t('cloudKeepMine')}</button>
      </div>
    </div>
  );
}

export function CloudSection() {
  const { t } = useT();
  const connection = useCloud((s) => s.connection);
  const user = useCloud((s) => s.user);
  const link = useCloud((s) => s.link);
  const status = useCloud((s) => s.status);
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const [busy, setBusy] = useState(false);
  const [menus, setMenus] = useState<CloudMenuSummary[] | null | 'loading' | 'error'>(null);
  const format = useFormatDate();
  const canWrite = user?.role === 'owner' || user?.role === 'editor';

  const loadList = async () => {
    setMenus('loading');
    const result = await cloud.list();
    setMenus(result ?? 'error');
  };

  const upload = async () => {
    setBusy(true);
    const ok = await cloud.uploadCurrent();
    setBusy(false);
    if (!ok && cloud.store.getState().connection === 'ready') notify(t('cloudUploadFailed'), 'error');
    if (ok && Array.isArray(menus)) void loadList();
  };

  const open = async (m: CloudMenuSummary) => {
    const title = m.title || t('cloudUntitled');
    if (!(await confirm(t('cloudOpenConfirm', { title }), t('cloudOpen')))) return;
    setBusy(true);
    const ok = await cloud.open(m.id);
    setBusy(false);
    if (!ok) notify(t('cloudOpenFailed'), 'error');
  };

  const disconnect = async () => {
    if (await confirm(t('cloudDisconnectConfirm'), t('cloudDisconnect'))) cloud.detach();
  };

  const signOut = async () => {
    setMenus(null);
    await cloud.signOut();
  };

  return (
    <Fieldset legend={`☁︎ ${t('cloudTitle')}`} className="cloud-section">
      {connection === 'checking' && <p className="hint" aria-busy="true">{t('cloudChecking')}</p>}
      {connection === 'noServer' && <p className="hint">{t('cloudNoServer')}</p>}
      {connection === 'signedOut' && (
        <>
          <p className="hint">{t('cloudSignedOut')}</p>
          {link?.dirty && <p className="hint">{t('cloudPendingSignIn')}</p>}
          <a className="btn btn-primary btn-block" href="#/login">{t('cloudSignIn')}</a>
        </>
      )}
      {connection === 'ready' && user && (
        <>
          <p className="cloud-user">
            <span dir="auto">{t('cloudSignedInAs', { email: user.email, role: t(ROLE_KEY[user.role]) })}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>{t('cloudSignOut')}</button>
          </p>

          {link ? (
            <>
              <p className="hint">{t('cloudLinked', { slug: link.slug })}</p>
              {status === 'readonly' && <p className="hint">{t('cloudReadonlyHint')}</p>}
              <div className="button-row">
                {canWrite && (
                  <button type="button" className="btn" disabled={busy || status === 'saving' || status === 'conflict'} onClick={() => void cloud.refresh(true)}>
                    {t('cloudSyncNow')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => void disconnect()}>{t('cloudDisconnect')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">{t('cloudLocalOnly')}</p>
              {canWrite ? (
                <button type="button" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy} onClick={() => void upload()}>
                  ☁︎ {t('cloudUpload')}
                </button>
              ) : (
                <p className="hint">{t('cloudReadonlyHint')}</p>
              )}
            </>
          )}

          {menus === null ? (
            <button type="button" className="btn btn-block" onClick={() => void loadList()}>{t('cloudShowMenus')}</button>
          ) : (
            <section className="cloud-menus" aria-labelledby="cloud-menus-title">
              <h3 id="cloud-menus-title">{t('cloudMenus')}</h3>
              <div role="status" aria-live="polite">
                {menus === 'loading' && <p className="hint">{t('cloudLoading')}</p>}
                {menus === 'error' && <p className="hint">{t('cloudListFailed')}</p>}
                {Array.isArray(menus) && menus.length === 0 && <p className="hint">{t('cloudNoMenus')}</p>}
              </div>
              {Array.isArray(menus) && menus.length > 0 && (
                <ul className="cloud-menu-list">
                  {menus.map((m) => {
                    const current = link?.menuId === m.id;
                    const date = format(m.updatedAt);
                    return (
                      <li key={m.id} className={current ? 'is-current' : undefined}>
                        <span className="cloud-menu-info">
                          <strong dir="auto">{m.title || t('cloudUntitled')}</strong>
                          <span className="hint">
                            <bdi dir="ltr">/{m.slug}</bdi> · {m.updatedBy ? t('cloudUpdatedBy', { date, name: m.updatedBy }) : t('cloudUpdated', { date })}
                          </span>
                        </span>
                        {current ? (
                          <span className="cloud-current">{t('cloudCurrent')}</span>
                        ) : (
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void open(m)} aria-label={`${t('cloudOpen')}: ${m.title || t('cloudUntitled')}`}>
                            {t('cloudOpen')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </Fieldset>
  );
}
