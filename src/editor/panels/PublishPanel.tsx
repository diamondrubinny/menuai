/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useId, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useMenuStore } from '../../store/menuStore';
import { useFeedback } from '../../store/feedbackStore';
import { useT } from '../../i18n/ui';
import { parseMenuJson, LIMITS } from '../../core/schema';
import { saveMenu } from '../../core/storage';
import { createEmptyMenu, createSampleMenu } from '../../core/sample';
import { Fieldset, Toggle } from '../fields/Fields';
import { useEditLocale } from '../EditLocalePicker';

const LARGE_EXPORT_MB = 8;

async function loadExporter() {
  // Loaded on demand: keeps react-dom/server out of the initial bundle.
  return import('../../core/exportHtml');
}

export function PublishPanel() {
  const menu = useMenuStore((s) => s.menu);
  const replace = useMenuStore((s) => s.replace);
  const notify = useFeedback((s) => s.notify);
  const confirm = useFeedback((s) => s.confirm);
  const { t } = useT();
  const locale = useEditLocale();
  const [embedFonts, setEmbedFonts] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportHtml = async () => {
    setBusy(true);
    try {
      const { exportMenuHtml, exportFileName, downloadText } = await loadExporter();
      const html = await exportMenuHtml(menu, { embedFonts });
      downloadText(html, exportFileName(menu, 'html'), 'text/html;charset=utf-8');
      const mb = new Blob([html]).size / 1024 / 1024;
      notify(mb > LARGE_EXPORT_MB ? t('exportLarge', { size: mb.toFixed(1) }) : t('exportDone'), mb > LARGE_EXPORT_MB ? 'info' : 'success');
    } catch {
      notify(t('exportFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportJson = async () => {
    const { exportFileName, downloadText } = await loadExporter();
    downloadText(JSON.stringify(menu, null, 2), exportFileName(menu, 'json'), 'application/json');
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    if (file.size > LIMITS.importBytes) return notify(t('importFailed', { error: 'File is too large' }), 'error');
    const result = parseMenuJson(await file.text());
    if (!result.ok) return notify(t('importFailed', { error: result.error }), 'error');
    if (!(await confirm(t('confirmReplace'), t('replace')))) return;
    replace(result.menu);
    notify(t('importDone'), 'success');
  };

  const openView = (print: boolean) => {
    saveMenu(menu); // make sure the new tab reads the latest version
    const query = new URLSearchParams({ lang: locale, ...(print ? { print: '1' } : {}) });
    window.open(`${window.location.pathname}#/view?${query.toString()}`, '_blank', 'noopener');
  };

  const replaceWith = async (factory: () => typeof menu) => {
    if (await confirm(t('confirmReplace'), t('replace'))) replace(factory());
  };

  return (
    <div className="panel-stack">
      <Fieldset legend={t('exportHtml')}>
        <p className="hint">{t('exportHtmlHint')}</p>
        <Toggle label={t('embedFonts')} checked={embedFonts} onChange={setEmbedFonts} />
        <button type="button" className="btn btn-primary btn-block" onClick={() => void exportHtml()} disabled={busy} aria-busy={busy}>
          {busy ? t('exporting') : `⬇ ${t('exportHtml')}`}
        </button>
      </Fieldset>

      <Fieldset legend={t('print')}>
        <p className="hint">{t('printHint')}</p>
        <button type="button" className="btn btn-block" onClick={() => openView(true)}>🖨 {t('print')}</button>
        <p className="hint">{t('fullViewHint')}</p>
        <button type="button" className="btn btn-block" onClick={() => openView(false)}>⛶ {t('fullView')}</button>
      </Fieldset>

      <QrSection />

      <Fieldset legend={t('backup')}>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void exportJson()}>{t('exportJson')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden tabIndex={-1} onChange={(e) => void importJson(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('importJson')}</button>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-ghost" onClick={() => void replaceWith(() => createEmptyMenu(menu.defaultLocale))}>{t('newMenu')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void replaceWith(createSampleMenu)}>{t('loadSample')}</button>
        </div>
      </Fieldset>
    </div>
  );
}

function QrSection() {
  const { t } = useT();
  const id = useId();
  const [url, setUrl] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  let valid = false;
  try {
    valid = new URL(url).protocol === 'https:' && url.length <= 1000;
  } catch {
    valid = false;
  }

  const download = () => {
    const svg = wrapRef.current?.querySelector('svg');
    if (!svg) return;
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
    const blob = new Blob([source], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'menu-qr.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <Fieldset legend={t('qr')}>
      <div className="field">
        <label htmlFor={id}>{t('qrUrl')}</label>
        <input id={id} type="url" inputMode="url" dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value.trim())} aria-describedby={`${id}-h`} aria-invalid={Boolean(url) && !valid} />
        <p className="hint" id={`${id}-h`}>{url && !valid ? t('qrInvalid') : t('qrHint')}</p>
      </div>
      {valid && (
        <div className="qr-wrap" ref={wrapRef}>
          <QRCodeSVG value={url} size={200} level="M" marginSize={2} bgColor="#ffffff" fgColor="#111111" title={url} />
          <button type="button" className="btn btn-sm" onClick={download}>{t('downloadQr')}</button>
        </div>
      )}
    </Fieldset>
  );
}
