/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, isNoServer, type ApiUser } from '../api/client';
import { inviteUser, listUsers, resendInvite, ROLES, updateUser, type Role, type TeamMember } from '../api/users';
import { useFeedback } from '../store/feedbackStore';
import { useT, type UiKey } from '../i18n/ui';

type Gate = { kind: 'loading' } | { kind: 'noServer' } | { kind: 'signedOut' } | { kind: 'notOwner' } | { kind: 'ready'; me: ApiUser };

const ROLE_KEY: Record<Role, UiKey> = { owner: 'roleOwner', editor: 'roleEditor', viewer: 'roleViewer' };
const ROLE_HINT: Record<Role, UiKey> = { owner: 'teamRoleOwnerHint', editor: 'teamRoleEditorHint', viewer: 'teamRoleViewerHint' };

/** Server error codes → messages. Unknown errors get a generic one (no internal details). */
function errorKey(error: string, status: number): UiKey {
  if (error === 'email_taken') return 'teamErrEmailTaken';
  if (error === 'last_owner') return 'teamErrLastOwner';
  if (error === 'too_many_links') return 'teamErrTooManyLinks';
  if (status === 400) return 'teamErrInvalid';
  if (status === 429) return 'loginTooMany';
  return 'teamErrFailed';
}

export function TeamPage() {
  const { t, dir, lang } = useT();
  const id = useId();
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const heading = useRef<HTMLHeadingElement>(null);
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [users, setUsers] = useState<TeamMember[] | null>(null);
  const [listError, setListError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'editor' as Role });
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<UiKey | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    heading.current?.focus();
    void api<{ user: ApiUser }>('/me').then((r) => {
      if (r.ok) setGate(r.data.user.role === 'owner' ? { kind: 'ready', me: r.data.user } : { kind: 'notOwner' });
      else if (r.status === 401) setGate({ kind: 'signedOut' });
      else setGate(isNoServer(r.status, r.error) ? { kind: 'noServer' } : { kind: 'signedOut' });
    });
  }, []);

  const load = useCallback(async () => {
    const r = await listUsers();
    if (r.ok) {
      setUsers(r.data.users);
      setListError(false);
    } else {
      setListError(true);
    }
  }, []);

  useEffect(() => {
    if (gate.kind === 'ready') void load();
  }, [gate.kind, load]);

  const date = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(d);
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setFormError(null);
    setLink(null);
    setSending(true);
    const r = await inviteUser({ email: form.email.trim(), name: form.name.trim(), role: form.role });
    setSending(false);
    if (!r.ok) return setFormError(errorKey(r.error, r.status));
    if (r.data.inviteLink) setLink({ email: r.data.user.email, url: r.data.inviteLink });
    else notify(t('teamInviteSent', { email: r.data.user.email }), 'success');
    setForm({ email: '', name: '', role: form.role });
    void load();
  };

  const change = async (user: TeamMember, patch: Partial<Pick<TeamMember, 'role' | 'disabled'>>, done: UiKey) => {
    setBusyId(user.id);
    const r = await updateUser(user.id, patch);
    setBusyId(null);
    if (!r.ok) {
      notify(t(errorKey(r.error, r.status)), 'error');
      return void load(); // show the real state again (e.g. the role select snaps back)
    }
    notify(t(done, { email: user.email }), 'success');
    setUsers((list) => list?.map((u) => (u.id === user.id ? r.data.user : u)) ?? null);
  };

  const toggleDisabled = async (user: TeamMember) => {
    if (!user.disabled && !(await confirm(t('teamDisableConfirm', { email: user.email }), t('teamDisable')))) return;
    await change(user, { disabled: !user.disabled }, user.disabled ? 'teamEnabled' : 'teamDisabled');
  };

  const resend = async (user: TeamMember) => {
    setBusyId(user.id);
    setLink(null);
    const r = await resendInvite(user.id);
    setBusyId(null);
    if (!r.ok) return notify(t(errorKey(r.error, r.status)), 'error');
    if (r.data.inviteLink) setLink({ email: user.email, url: r.data.inviteLink });
    else notify(t('teamInviteSent', { email: user.email }), 'success');
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify(t('cloudCopied'), 'success');
    } catch {
      notify(t('teamCopyManually'), 'info');
    }
  };

  return (
    <main className="doc-page team-page" id="main">
      <p><a href="#/"><span aria-hidden="true">{dir === 'rtl' ? '→' : '←'}</span> {t('backToEditor')}</a></p>
      <h1 ref={heading} tabIndex={-1}>{t('teamTitle')}</h1>

      <div role="status" aria-live="polite">
        {gate.kind === 'loading' && <p className="hint">{t('cloudChecking')}</p>}
        {gate.kind === 'noServer' && <p className="notice notice-error">{t('cloudNoServer')}</p>}
        {gate.kind === 'notOwner' && <p className="notice notice-error">{t('teamOwnerOnly')}</p>}
      </div>
      {gate.kind === 'signedOut' && (
        <>
          <p>{t('cloudSignedOut')}</p>
          <p><a className="btn btn-primary" href="#/login">{t('cloudSignIn')}</a></p>
        </>
      )}

      {gate.kind === 'ready' && (
        <>
          <p className="hint">{t('teamIntro')}</p>

          <section className="team-invite" aria-labelledby={`${id}-inv`}>
            <h2 id={`${id}-inv`}>{t('teamInviteTitle')}</h2>
            <form className="team-form" onSubmit={(e) => void invite(e)} noValidate>
              <div className="field">
                <label htmlFor={`${id}-email`}>{t('loginEmail')}</label>
                <input
                  id={`${id}-email`} type="email" inputMode="email" autoComplete="off" dir="ltr" required maxLength={254}
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  aria-invalid={formError === 'teamErrInvalid' || formError === 'teamErrEmailTaken'}
                  aria-describedby={formError ? `${id}-err` : undefined}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-name`}>{t('teamName')}</label>
                <input id={`${id}-name`} type="text" autoComplete="off" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-role`}>{t('teamRole')}</label>
                <select id={`${id}-role`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} aria-describedby={`${id}-role-h`}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_KEY[r])}</option>)}
                </select>
                <p className="hint" id={`${id}-role-h`}>{t(ROLE_HINT[form.role])}</p>
              </div>
              <button type="submit" className="btn btn-primary" disabled={sending || !form.email.trim()} aria-busy={sending}>
                {sending ? t('sending') : t('teamInvite')}
              </button>
              {formError && <p className="error" id={`${id}-err`} role="alert">{t(formError)}</p>}
            </form>
          </section>

          {link && (
            <div className="notice notice-success team-link" role="status">
              <p>{t('teamLinkReady', { email: link.email })}</p>
              <p className="team-link-url"><bdi dir="ltr">{link.url}</bdi></p>
              <div className="button-row">
                <button type="button" className="btn btn-sm" onClick={() => void copy(link.url)}>{t('cloudCopyLink')}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLink(null)}>{t('close')}</button>
              </div>
              <p className="hint">{t('teamLinkHint')}</p>
            </div>
          )}

          <section aria-labelledby={`${id}-list`}>
            <h2 id={`${id}-list`}>{t('teamMembers')}</h2>
            {listError && <p className="notice notice-error" role="alert">{t('cloudListFailed')}</p>}
            {users === null && !listError && <p className="hint">{t('cloudLoading')}</p>}
            {users && (
              <div className="team-table-wrap">
                <table className="team-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('teamMember')}</th>
                      <th scope="col">{t('teamRole')}</th>
                      <th scope="col">{t('teamStatus')}</th>
                      <th scope="col"><span className="visually-hidden">{t('teamActions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const self = u.id === gate.me.id;
                      const busy = busyId === u.id;
                      return (
                        <tr key={u.id} className={u.disabled ? 'is-disabled' : undefined} aria-busy={busy}>
                          <th scope="row">
                            <span className="team-name" dir="auto">{u.name || u.email}{self && <span className="team-self"> {t('teamYou')}</span>}</span>
                            {u.name && <span className="hint team-email"><bdi dir="ltr">{u.email}</bdi></span>}
                            <span className="hint">{t('teamJoined', { date: date(u.createdAt) })}</span>
                          </th>
                          <td>
                            <label className="visually-hidden" htmlFor={`${id}-r-${u.id}`}>{t('teamRoleOf', { email: u.email })}</label>
                            <select
                              id={`${id}-r-${u.id}`} value={u.role} disabled={busy || u.disabled || self}
                              onChange={(e) => void change(u, { role: e.target.value as Role }, 'teamRoleChanged')}
                            >
                              {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_KEY[r])}</option>)}
                            </select>
                          </td>
                          <td>
                            <span className={`team-badge${u.disabled ? ' is-off' : ''}`}>{t(u.disabled ? 'teamStatusDisabled' : 'teamStatusActive')}</span>
                          </td>
                          <td>
                            <div className="team-actions">
                              {!u.disabled && !self && (
                                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void resend(u)} aria-label={`${t('teamResend')}: ${u.email}`}>
                                  {t('teamResend')}
                                </button>
                              )}
                              {!self && (
                                <button
                                  type="button" className={`btn btn-sm${u.disabled ? '' : ' btn-ghost btn-danger-text'}`} disabled={busy}
                                  onClick={() => void toggleDisabled(u)} aria-label={`${t(u.disabled ? 'teamEnable' : 'teamDisable')}: ${u.email}`}
                                >
                                  {t(u.disabled ? 'teamEnable' : 'teamDisable')}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
