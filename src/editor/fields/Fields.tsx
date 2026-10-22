/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import type { ImageRef, Localized } from '../../core/schema';
import { getLocaleInfo } from '../../core/locales';
import { hasTranslation } from '../../core/localize';
import { ImageProcessError, normalizeImageUrl, processImageFile } from '../../core/images';
import { useT, type UiKey } from '../../i18n/ui';

interface LocalizedFieldProps {
  label: string;
  value: Localized;
  locale: string;
  fallbackLocale: string;
  onChange: (next: Localized) => void;
  multiline?: boolean;
  maxLength?: number;
}

/** Text input for one language of a multilingual value. Shows the default-language text as a hint. */
export function LocalizedField({ label, value, locale, fallbackLocale, onChange, multiline, maxLength = 1200 }: LocalizedFieldProps) {
  const id = useId();
  const { t } = useT();
  const info = getLocaleInfo(locale);
  const fallbackText = locale !== fallbackLocale ? value[fallbackLocale] ?? '' : '';
  const missing = Boolean(fallbackText.trim()) && !hasTranslation(value, locale);
  const set = (text: string) => {
    const next = { ...value };
    if (text) next[locale] = text;
    else delete next[locale];
    onChange(next);
  };
  const common = {
    id,
    lang: locale,
    dir: info.dir,
    value: value[locale] ?? '',
    placeholder: fallbackText,
    maxLength,
    'aria-describedby': missing ? `${id}-missing` : undefined,
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {missing && (
          <span className="badge badge-warn" id={`${id}-missing`}>
            {t('missingTranslation')}
          </span>
        )}
      </label>
      {multiline ? (
        <textarea {...common} rows={2} onChange={(e) => set(e.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(e) => set(e.target.value)} />
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  const id = useId();
  return (
    <div className="toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={description ? `${id}-d` : undefined} />
      <label htmlFor={id}>
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc" id={`${id}-d`}>{description}</span>}
      </label>
    </div>
  );
}

export function NumberField({ label, value, onChange, min = 0, max, step = 1, suffix }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-affix">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft ?? (value === undefined ? '' : String(value))}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw === '') return onChange(undefined);
            const n = Number(raw);
            if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onChange(n);
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className="affix" aria-hidden="true">{suffix}</span>}
      </div>
    </div>
  );
}

export function Fieldset({ legend, children, className }: { legend: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`fieldset ${className ?? ''}`}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

const IMAGE_ERRORS: Record<string, UiKey> = {
  type: 'imageErrType',
  size: 'imageErrSize',
  decode: 'imageErrDecode',
  tooLarge: 'imageErrTooLarge',
};

interface ImageFieldProps {
  label: string;
  value: ImageRef | undefined;
  onChange: (next: ImageRef | undefined) => void;
  locale: string;
  fallbackLocale: string;
}

export function ImageField({ label, value, onChange, locale, fallbackLocale }: ImageFieldProps) {
  const { t } = useT();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const src = await processImageFile(file);
      onChange({ src, alt: value?.alt ?? {} });
    } catch (err) {
      const code = err instanceof ImageProcessError ? err.code : 'decode';
      setError(t(IMAGE_ERRORS[code] ?? 'imageErrDecode'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onUrl = () => {
    const src = normalizeImageUrl(url);
    if (!src) return setError(t('imageErrUrl'));
    setError(null);
    setUrl('');
    onChange({ src, alt: value?.alt ?? {} });
  };

  return (
    <div className="image-field" role="group" aria-labelledby={`${id}-l`}>
      <div className="image-field-label" id={`${id}-l`}>{label}</div>
      {value ? (
        <div className="image-preview">
          <img src={value.src} alt="" />
          <div className="image-preview-side">
            <LocalizedField
              label={t('altText')}
              value={value.alt}
              locale={locale}
              fallbackLocale={fallbackLocale}
              onChange={(alt) => onChange({ ...value, alt })}
              maxLength={200}
            />
            {value.src.startsWith('https:') && <p className="hint hint-warn">{t('externalImageWarning')}</p>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)}>
              {t('removeImage')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="image-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              tabIndex={-1}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button type="button" className="btn btn-sm" aria-busy={busy} disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? '…' : t('uploadImage')}
            </button>
          </div>
          <div className="url-row">
            <label className="visually-hidden" htmlFor={`${id}-url`}>{t('imageUrl')}</label>
            <input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder={t('imageUrl')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onUrl(); } }}
            />
            <button type="button" className="btn btn-sm" onClick={onUrl} disabled={!url.trim()}>
              {t('useUrl')}
            </button>
          </div>
          <p className="hint">{t('imageHint')}</p>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
