import { useId } from 'react';
import { useMenuStore } from '../store/menuStore';
import { useEditorStore } from '../store/editorStore';
import { getLocaleInfo } from '../core/locales';
import { useT } from '../i18n/ui';

/** The content language currently being edited (always one of the menu's languages). */
export function useEditLocale(): string {
  const locales = useMenuStore((s) => s.menu.locales);
  const fallback = useMenuStore((s) => s.menu.defaultLocale);
  const chosen = useEditorStore((s) => s.editLocale);
  return chosen && locales.includes(chosen) ? chosen : fallback;
}

export function EditLocalePicker() {
  const id = useId();
  const { t } = useT();
  const locales = useMenuStore((s) => s.menu.locales);
  const defaultLocale = useMenuStore((s) => s.menu.defaultLocale);
  const locale = useEditLocale();
  const setEditLocale = useEditorStore((s) => s.setEditLocale);
  if (locales.length < 2) return null;
  return (
    <div className="edit-locale" role="group" aria-labelledby={id}>
      <span id={id} className="edit-locale-label">{t('editingLanguage')}</span>
      <div className="segmented">
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={code === locale}
            onClick={() => setEditLocale(code)}
            lang={code}
          >
            {getLocaleInfo(code).nativeName}
            {code === defaultLocale && <span className="dot" aria-hidden="true">★</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
