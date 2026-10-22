import { useT } from '../i18n/ui';

export const REPO_URL = 'https://github.com/diamondrubinny/menuai';

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="site-footer">
      <a href="#/accessibility">{t('accessibility')}</a>
      <a href="#/privacy">{t('privacy')}</a>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t('sourceCode')}</a>
    </footer>
  );
}
