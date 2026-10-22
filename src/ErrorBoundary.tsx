/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate, useUiLang } from './i18n/ui';

interface State {
  failed: boolean;
}

/** Last-resort error screen. Never shows stack traces to the user. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const lang = useUiLang.getState().lang;
    const he = lang === 'he';
    return (
      <main className="doc-page" role="alert">
        <h1>{he ? 'משהו השתבש' : 'Something went wrong'}</h1>
        <p>
          {he
            ? 'הטיוטה שלכם שמורה בדפדפן. נסו לרענן את הדף; אם הבעיה חוזרת, ייצאו גיבוי JSON מלשונית „פרסום”.'
            : 'Your draft is saved in this browser. Try reloading the page; if it happens again, export a JSON backup from the Publish tab.'}
        </p>
        <p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            {he ? 'רענון' : 'Reload'}
          </button>{' '}
          <a className="btn" href="#/">{translate(lang, 'backToEditor')}</a>
        </p>
      </main>
    );
  }
}
