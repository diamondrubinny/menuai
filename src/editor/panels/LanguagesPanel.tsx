/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useId, useMemo, useState } from 'react';
import { useMenuStore } from '../../store/menuStore';
import { useEditorStore } from '../../store/editorStore';
import { useFeedback } from '../../store/feedbackStore';
import { useT } from '../../i18n/ui';
import { LOCALES, LOCALE_CODE_RE, getLocaleInfo } from '../../core/locales';
import { CURRENCIES } from '../../core/format';
import { LABEL_KEYS, LIMITS, type LabelKey, type Localized, type Menu } from '../../core/schema';
import { BUILTIN_LABELS, hasBuiltinLabels, label } from '../../core/labels';
import { Fieldset } from '../fields/Fields';

/** All translatable values of a menu, for translation progress. */
function localizedValues(menu: Menu): Localized[] {
  const values: Localized[] = [menu.title, menu.subtitle, menu.footerNote];
  for (const s of menu.sections) {
    values.push(s.title, s.description);
    for (const i of s.items) {
      values.push(i.name, i.description, ...i.variants.map((v) => v.label));
    }
  }
  return values.filter((v) => Object.values(v).some((x) => x.trim()));
}

export function translationProgress(menu: Menu, locale: string): number {
  const values = localizedValues(menu);
  if (values.length === 0) return 100;
  const done = values.filter((v) => v[locale]?.trim()).length;
  return Math.round((done / values.length) * 100);
}

/** Removes a language's text from every localized value. */
function stripLocale(menu: Menu, code: string): Menu {
  const strip = (v: Localized): Localized => {
    const { [code]: _removed, ...rest } = v;
    return rest;
  };
  const { [code]: _labels, ...labels } = menu.labels;
  return {
    ...menu,
    title: strip(menu.title),
    subtitle: strip(menu.subtitle),
    footerNote: strip(menu.footerNote),
    logo: menu.logo && { ...menu.logo, alt: strip(menu.logo.alt) },
    hero: menu.hero && { ...menu.hero, alt: strip(menu.hero.alt) },
    labels,
    sections: menu.sections.map((s) => ({
      ...s,
      title: strip(s.title),
      description: strip(s.description),
      items: s.items.map((i) => ({
        ...i,
        name: strip(i.name),
        description: strip(i.description),
        image: i.image && { ...i.image, alt: strip(i.image.alt) },
        variants: i.variants.map((v) => ({ ...v, label: strip(v.label) })),
      })),
    })),
  };
}

export function LanguagesPanel() {
  const menu = useMenuStore((s) => s.menu);
  const update = useMenuStore((s) => s.update);
  const setEditLocale = useEditorStore((s) => s.setEditLocale);
  const confirm = useFeedback((s) => s.confirm);
  const { t } = useT();
  const selectId = useId();
  const customId = useId();
  const currencyId = useId();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => LOCALES.filter((l) => !menu.locales.includes(l.code)), [menu.locales]);

  const addLocale = (code: string) => {
    const normalized = code.trim();
    if (!LOCALE_CODE_RE.test(normalized) || menu.locales.includes(normalized) || menu.locales.length >= LIMITS.locales) {
      setError(t('invalidCode'));
      return;
    }
    setError(null);
    update((m) => ({ ...m, locales: [...m.locales, normalized] }));
    setEditLocale(normalized);
  };

  const removeLocale = async (code: string) => {
    const name = getLocaleInfo(code).nativeName;
    if (!(await confirm(t('confirmRemoveLanguage', { lang: name }), t('remove')))) return;
    update((m) => ({ ...stripLocale(m, code), locales: m.locales.filter((l) => l !== code) }));
  };

  return (
    <div className="panel-stack">
      <Fieldset legend={t('menuLanguages')}>
        <ul className="locale-list">
          {menu.locales.map((code) => {
            const info = getLocaleInfo(code);
            const isDefault = code === menu.defaultLocale;
            const progress = translationProgress(menu, code);
            return (
              <li key={code} className="locale-row">
                <div className="locale-name">
                  <span lang={code} dir={info.dir}>{info.nativeName}</span>
                  <span className="muted" dir="ltr">{code}</span>
                  {isDefault && <span className="badge">{t('defaultLanguage')}</span>}
                </div>
                <div className="progress" aria-hidden="true"><span style={{ inlineSize: `${progress}%` }} /></div>
                <span className="muted small">{t('translated', { percent: progress })}</span>
                <div className="row-actions">
                  {!isDefault && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((m) => ({ ...m, defaultLocale: code }))}>
                        {t('setDefault')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => void removeLocale(code)}>
                        {t('removeLanguage')} <span className="visually-hidden">{info.nativeName}</span>
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Fieldset>

      <Fieldset legend={t('addLanguage')}>
        <div className="field">
          <label htmlFor={selectId}>{t('addLanguage')}</label>
          <select
            id={selectId}
            value=""
            onChange={(e) => e.target.value && addLocale(e.target.value)}
          >
            <option value="">{t('chooseLanguage')}</option>
            {available.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName} — {l.englishName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={customId}>{t('customCode')}</label>
          <div className="url-row">
            <input id={customId} dir="ltr" value={custom} maxLength={16} onChange={(e) => setCustom(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${customId}-e` : undefined} />
            <button type="button" className="btn btn-sm" disabled={!custom.trim()} onClick={() => { addLocale(custom); setCustom(''); }}>
              {t('add')}
            </button>
          </div>
          {error && <p className="error" id={`${customId}-e`} role="alert">{error}</p>}
        </div>
      </Fieldset>

      <Fieldset legend={t('currency')}>
        <div className="field">
          <label htmlFor={currencyId} className="visually-hidden">{t('currency')}</label>
          <select id={currencyId} value={menu.currency} onChange={(e) => update((m) => ({ ...m, currency: e.target.value }))}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </Fieldset>

      <LabelsEditor />
    </div>
  );
}

function LabelsEditor() {
  const menu = useMenuStore((s) => s.menu);
  const update = useMenuStore((s) => s.update);
  const { t } = useT();
  const id = useId();
  const [code, setCode] = useState(menu.defaultLocale);
  const active = menu.locales.includes(code) ? code : menu.defaultLocale;
  const info = getLocaleInfo(active);

  const setLabel = (key: LabelKey, value: string) =>
    update((m) => {
      const current = { ...(m.labels[active] ?? {}) };
      if (value) current[key] = value;
      else delete current[key];
      return { ...m, labels: { ...m.labels, [active]: current } };
    }, `labels.${active}.${key}`);

  return (
    <Fieldset legend={t('menuLabels')}>
      <p className="hint">{t('menuLabelsHint')}</p>
      <div className="field">
        <label htmlFor={id}>{t('labelsFor')}</label>
        <select id={id} value={active} onChange={(e) => setCode(e.target.value)}>
          {menu.locales.map((c) => <option key={c} value={c}>{getLocaleInfo(c).nativeName}</option>)}
        </select>
      </div>
      {!hasBuiltinLabels(active) && <p className="hint hint-warn">{t('noBuiltinLabels')}</p>}
      <div className="labels-grid">
        {LABEL_KEYS.map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`${id}-${key}`} dir="ltr" className="mono">{key}</label>
            <input
              id={`${id}-${key}`}
              lang={active}
              dir={info.dir}
              maxLength={LIMITS.text}
              value={menu.labels[active]?.[key] ?? ''}
              placeholder={label({ labels: {} }, active, key) || BUILTIN_LABELS.en![key]}
              onChange={(e) => setLabel(key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </Fieldset>
  );
}
