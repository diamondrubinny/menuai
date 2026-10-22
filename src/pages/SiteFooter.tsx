/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useT } from '../i18n/ui';
import { BRAND, creditText } from '../core/brand';

export const REPO_URL = BRAND.repo;

export function SiteFooter() {
  const { t, lang } = useT();
  const credit = creditText(lang);
  return (
    <footer className="site-footer">
      <span className="site-credit" data-ma-credit="">
        {credit.poweredBy} <strong lang="en" dir="ltr">{BRAND.name}</strong> · {credit.openSource}
      </span>
      <a href="#/accessibility">{t('accessibility')}</a>
      <a href="#/privacy">{t('privacy')}</a>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t('sourceCode')}</a>
    </footer>
  );
}
