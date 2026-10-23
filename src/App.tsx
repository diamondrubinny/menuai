/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect } from 'react';
import { useRoute } from './router';
import { useT } from './i18n/ui';
import { Editor } from './editor/Editor';
import { ConfirmHost, Toasts } from './editor/Feedback';
import { ViewPage } from './pages/ViewPage';
import { AccessibilityPage, PrivacyPage } from './pages/DocPages';
import { NotFound } from './pages/NotFound';
import { LoginPage } from './pages/LoginPage';
import { TeamPage } from './pages/TeamPage';

export function App() {
  const route = useRoute();
  const { t, lang, dir } = useT();
  const isView = route.path === '/view';

  useEffect(() => {
    if (isView) return; // the view page sets lang/dir from the menu language
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = `${t('appName')} — ${t('tagline')}`;
  }, [lang, dir, isView, t]);

  let page;
  switch (route.path) {
    case '/':
      page = <Editor />;
      break;
    case '/view':
      page = <ViewPage route={route} />;
      break;
    case '/accessibility':
      page = <AccessibilityPage />;
      break;
    case '/privacy':
      page = <PrivacyPage />;
      break;
    case '/login':
      page = <LoginPage route={route} />;
      break;
    case '/team':
      page = <TeamPage />;
      break;
    default:
      page = <NotFound />;
  }

  return (
    <>
      {page}
      <Toasts />
      <ConfirmHost />
    </>
  );
}
