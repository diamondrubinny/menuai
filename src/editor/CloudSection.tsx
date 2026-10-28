/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, useId, useState } from 'react';
import { cloud, embeddedImageCount, moveImagesToServer, useCloud } from '../store/cloudStore';
import { useMenuStore } from '../store/menuStore';
import { useFeedback } from '../store/feedbackStore';
import { useT, type UiKey } from '../i18n/ui';
import type { CloudMenuSummary, PublishResult, SyncStatus } from '../cloud/sync';
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
          {user.role !== 'viewer' && (
            <p className="button-row">
              {user.role === 'owner' && <a className="btn btn-sm" href="#/team">👥 {t('teamManage')}</a>}
              <a className="btn btn-sm" href="#/payments">💳 {t('payManage')}</a>
            </p>
          )}

          {link ? (
            <>
              <p className="hint">{t('cloudLinked', { slug: link.slug })}</p>
              <PublishControls />
              {canWrite && <MoveImages />}
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

const PUBLISH_ERROR: Record<Exclude<PublishResult, { ok: true }>['reason'], UiKey> = {
  notSynced: 'cloudPublishNotSynced',
  changed: 'cloudPublishChanged',
  forbidden: 'cloudReadonlyHint',
  failed: 'cloudPublishFailed',
};

/** Publish to the permanent address, see what is live, browse and restore published versions. */
function PublishControls() {
  const { t } = useT();
  const user = useCloud((s) => s.user);
  const link = useCloud((s) => s.link);
  const history = useCloud((s) => (s.history && s.history.menuId === s.link?.menuId ? s.history : null));
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const format = useFormatDate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'publish' | 'restore' | 'unpublish' | null>(null);
  const noteId = useId();
  const canWrite = user?.role === 'owner' || user?.role === 'editor';
  const isOwner = user?.role === 'owner';
  const menuId = link?.menuId;

  useEffect(() => {
    if (menuId) void cloud.loadHistory();
  }, [menuId]);

  const publish = async () => {
    setBusy('publish');
    const result = await cloud.publish(note.trim());
    setBusy(null);
    if (result.ok) {
      setNote('');
      notify(t('cloudPublished'), 'success');
    } else {
      notify(t(PUBLISH_ERROR[result.reason]), 'error');
    }
  };

  const unpublish = async () => {
    if (!(await confirm(t('cloudUnpublishConfirm'), t('cloudUnpublish')))) return;
    setBusy('unpublish');
    const ok = await cloud.unpublish();
    setBusy(null);
    notify(t(ok ? 'cloudUnpublished' : 'cloudPublishFailed'), ok ? 'info' : 'error');
  };

  const restore = async (versionId: string, version: number) => {
    if (!(await confirm(t('cloudRestoreConfirm', { version }), t('cloudRestore')))) return;
    setBusy('restore');
    const ok = await cloud.restore(versionId);
    setBusy(null);
    notify(ok ? t('cloudRestored', { version }) : t('cloudRestoreFailed'), ok ? 'success' : 'error');
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify(t('cloudCopied'), 'success');
    } catch {
      notify(url, 'info');
    }
  };

  const publication = history?.publication ?? null;
  return (
    <section className="cloud-publish" aria-labelledby={`${noteId}-title`}>
      <h3 id={`${noteId}-title`}>{t('cloudPublishTitle')}</h3>
      <div role="status" aria-live="polite">
        {publication ? (
          <div className="cloud-live">
            <p className="cloud-live-label"><span className="live-dot" aria-hidden="true" /> {t('cloudLiveAt')}</p>
            <p className="cloud-live-url"><bdi dir="ltr">{publication.url}</bdi></p>
            <p className="hint">
              {publication.publishedBy
                ? t('cloudLastPublished', { version: publication.version, date: format(publication.publishedAt), name: publication.publishedBy })
                : t('cloudLastPublishedNoName', { version: publication.version, date: format(publication.publishedAt) })}
            </p>
          </div>
        ) : (
          history && <p className="hint">{t('cloudNotLive')}</p>
        )}
      </div>
      {publication && (
        <div className="button-row">
          <a className="btn btn-sm" href={publication.url} target="_blank" rel="noopener noreferrer">{t('cloudOpenLive')}</a>
          <button type="button" className="btn btn-sm" onClick={() => void copy(publication.url)}>{t('cloudCopyLink')}</button>
          {isOwner && (
            <button type="button" className="btn btn-sm btn-ghost btn-danger-text" disabled={busy !== null} onClick={() => void unpublish()}>
              {t('cloudUnpublish')}
            </button>
          )}
        </div>
      )}

      {canWrite && (
        <>
          <p className="hint">{t('cloudPublishHint')}</p>
          <div className="field">
            <label htmlFor={noteId}>{t('cloudPublishNote')}</label>
            <input id={noteId} type="text" maxLength={200} value={note} placeholder={t('cloudPublishNotePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => void publish()}>
            {busy === 'publish' ? t('cloudPublishing') : `🚀 ${t('cloudPublish')}`}
          </button>
        </>
      )}

      {history && (
        <details className="cloud-history">
          <summary>{t('cloudHistory', { count: history.versions.length })}</summary>
          {history.versions.length === 0 ? (
            <p className="hint">{t('cloudHistoryEmpty')}</p>
          ) : (
            <>
              <ol className="cloud-version-list">
                {history.versions.map((v) => (
                  <li key={v.id}>
                    <span className="cloud-menu-info">
                      <strong>
                        {t('cloudVersionLabel', { version: v.version })}
                        {v.live && <span className="badge-live">{t('cloudLiveBadge')}</span>}
                      </strong>
                      {v.note && <span dir="auto">{v.note}</span>}
                      <span className="hint">{v.createdBy ? t('cloudVersionBy', { date: format(v.createdAt), name: v.createdBy }) : format(v.createdAt)}</span>
                    </span>
                    {isOwner && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy !== null}
                        onClick={() => void restore(v.id, v.version)}
                        aria-label={`${t('cloudRestore')}: ${t('cloudVersionLabel', { version: v.version })}`}
                      >
                        {t('cloudRestore')}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              <p className="hint">{t('cloudHistoryLimit')}</p>
            </>
          )}
        </details>
      )}
    </section>
  );
}

/** Offers to move images embedded in the menu (data URLs) to the server, where they are scanned and optimized. */
function MoveImages() {
  const { t } = useT();
  const notify = useFeedback((s) => s.notify);
  // Re-evaluated on every menu change; cheap (a walk over the image references).
  const count = useMenuStore(() => embeddedImageCount());
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;

  const move = async () => {
    setBusy(true);
    const { moved, failed } = await moveImagesToServer();
    setBusy(false);
    if (moved) notify(t('cloudMovedImages', { moved }), 'success');
    if (failed) notify(t('cloudMoveImagesFailed', { failed }), 'error');
  };

  return (
    <div className="cloud-move-images">
      <p className="hint">{t('cloudMoveImagesHint')}</p>
      <button type="button" className="btn btn-block" disabled={busy} aria-busy={busy} onClick={() => void move()}>
        {busy ? t('cloudMovingImages') : t('cloudMoveImages', { count })}
      </button>
    </div>
  );
}
