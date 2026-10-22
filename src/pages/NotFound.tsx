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
