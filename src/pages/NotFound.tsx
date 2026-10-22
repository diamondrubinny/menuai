/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useT } from '../i18n/ui';

export function NotFound() {
  const { t } = useT();
  return (
    <main className="doc-page" id="main">
      <h1>{t('notFound')}</h1>
      <p>{t('notFoundText')}</p>
      <p><a className="btn btn-primary" href="#/">{t('backToEditor')}</a></p>
    </main>
  );
}
