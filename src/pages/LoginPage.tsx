/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, isNoServer, type ApiUser } from '../api/client';
import { useT, type UiKey } from '../i18n/ui';
import type { Route } from '../router';

type State =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'verifying' }
  | { kind: 'signedIn'; user: ApiUser }
  | { kind: 'error'; message: UiKey };

/** Tokens already submitted in this page load (React StrictMode runs effects twice in development). */
const submitted = new Set<string>();

function errorKey(status: number, error: string): UiKey {
  // No server installed (static hosting) or not reachable: unreachable, 404, or a proxy error page.
  if (isNoServer(status, error)) return 'loginNoServer';
  if (error === 'invalid_or_expired') return 'loginLinkInvalid';
  if (status === 429) return 'loginTooMany';
  if (error === 'invalid_email') return 'loginBadEmail';
  return 'loginFailed';
}

export function LoginPage({ route }: { route: Route }) {
  const { t, dir } = useT();
  const id = useId();
  const token = route.params.get('token');
  const [state, setState] = useState<State>(token ? { kind: 'verifying' } : { kind: 'form' });
  const [email, setEmail] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [state.kind]);

  useEffect(() => {
    if (!token || submitted.has(token)) return;
    submitted.add(token);
    // Drop the token from the address bar and history right away.
    window.history.replaceState(null, '', `${window.location.pathname}#/login`);
    void api<{ user: ApiUser }>('/auth/verify', { method: 'POST', body: { token } }).then((r) =>
      setState(r.ok ? { kind: 'signedIn', user: r.data.user } : { kind: 'error', message: errorKey(r.status, r.error) }),
    );
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.kind === 'sending') return;
    setState({ kind: 'sending' });
    const r = await api('/auth/request-link', { method: 'POST', body: { email } });
    setState(r.ok ? { kind: 'sent' } : { kind: 'error', message: errorKey(r.status, r.error) });
  };

  return (
    <main className="doc-page login-page" id="main">
      <p><a href="#/"><span aria-hidden="true">{dir === 'rtl' ? '→' : '←'}</span> {t('backToEditor')}</a></p>
      <h1 ref={heading} tabIndex={-1}>{t('loginTitle')}</h1>
      <div role="status" aria-live="polite">
        {state.kind === 'verifying' && <p>{t('loginVerifying')}</p>}
        {state.kind === 'sent' && <p className="notice notice-success">{t('loginSent')}</p>}
        {state.kind === 'signedIn' && (
          <>
            <p className="notice notice-success">{t('loginSuccess', { email: state.user.email })}</p>
            <p><a className="btn btn-primary" href="#/">{t('backToEditor')}</a></p>
          </>
        )}
        {state.kind === 'error' && <p className="notice notice-error">{t(state.message)}</p>}
      </div>
      {(state.kind === 'form' || state.kind === 'sending' || state.kind === 'error' || state.kind === 'sent') && (
        <form className="login-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <p className="hint">{t('loginHint')}</p>
          <div className="field">
            <label htmlFor={`${id}-email`}>{t('loginEmail')}</label>
            <input
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={state.kind === 'sending' || !email.trim()} aria-busy={state.kind === 'sending'}>
            {state.kind === 'sending' ? t('sending') : t('loginSend')}
          </button>
        </form>
      )}
    </main>
  );
}
