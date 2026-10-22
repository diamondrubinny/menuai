import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMenuStore } from '../store/menuStore';
import { DEVICE_SIZES, useEditorStore, type Device } from '../store/editorStore';
import { MenuRenderer } from '../renderer/MenuRenderer';
import { initMenuRuntime, type MenuRuntime } from '../renderer/menuRuntime.js';
import { getLocaleInfo } from '../core/locales';
import { useT } from '../i18n/ui';

const DEVICES: Device[] = ['phone', 'tablet', 'desktop', 'tv'];
const DEVICE_ICONS: Record<Device, string> = { phone: '📱', tablet: '▭', desktop: '🖥', tv: '📺' };

function usePreviewLocale(): string {
  const locales = useMenuStore((s) => s.menu.locales);
  const fallback = useMenuStore((s) => s.menu.defaultLocale);
  const chosen = useEditorStore((s) => s.previewLocale);
  return chosen && locales.includes(chosen) ? chosen : fallback;
}

export function PreviewToolbar() {
  const { t } = useT();
  const device = useEditorStore((s) => s.device);
  const setDevice = useEditorStore((s) => s.setDevice);
  const toggleLandscape = useEditorStore((s) => s.toggleLandscape);
  const landscape = useEditorStore((s) => s.landscape);
  const locales = useMenuStore((s) => s.menu.locales);
  const setPreviewLocale = useEditorStore((s) => s.setPreviewLocale);
  const locale = usePreviewLocale();

  return (
    <div className="preview-toolbar">
      <div className="segmented" role="group" aria-label={t('device')}>
        {DEVICES.map((d) => (
          <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} title={t(`device_${d}`)}>
            <span aria-hidden="true">{DEVICE_ICONS[d]}</span>
            <span className="segmented-text">{t(`device_${d}`)}</span>
          </button>
        ))}
      </div>
      {(device === 'phone' || device === 'tablet') && (
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={landscape} onClick={toggleLandscape}>
          ⟳ {t('rotate')}
        </button>
      )}
      {locales.length > 1 && (
        <label className="inline-select">
          <span>{t('previewLanguage')}</span>
          <select value={locale} onChange={(e) => setPreviewLocale(e.target.value)}>
            {locales.map((code) => <option key={code} value={code}>{getLocaleInfo(code).nativeName}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export function DevicePreview() {
  const { t } = useT();
  const menu = useMenuStore((s) => s.menu);
  const device = useEditorStore((s) => s.device);
  const landscape = useEditorStore((s) => s.landscape);
  const setPreviewLocale = useEditorStore((s) => s.setPreviewLocale);
  const locale = usePreviewLocale();
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MenuRuntime | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const base = DEVICE_SIZES[device];
  // On an actual phone, the phone preview fills the screen instead of drawing a phone inside a phone.
  const fit = device === 'phone' && !landscape && stage.w > 0 && stage.w < 520;
  const size = fit ? stage : landscape ? { w: base.h, h: base.w } : base;
  const pad = fit ? 0 : 24;
  const scale = stage.w ? Math.min(1, (stage.w - pad) / size.w, (stage.h - pad) / size.h) : 0;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!contentRef.current || !screenRef.current) return;
    runtimeRef.current = initMenuRuntime(contentRef.current, { scrollRoot: screenRef.current });
    return () => runtimeRef.current?.destroy();
  }, []);

  useEffect(() => {
    runtimeRef.current?.refresh();
  }, [menu, locale, device, landscape]);

  return (
    <div className="device-stage" ref={stageRef}>
      <div
        className={`device-frame device-${device}${landscape ? ' is-landscape' : ''}${fit ? ' is-fit' : ''}`}
        style={{ width: size.w * scale, height: size.h * scale, visibility: scale ? 'visible' : 'hidden' }}
      >
        <div
          className="device-screen"
          ref={screenRef}
          style={{ width: size.w, height: size.h, transform: `scale(${scale})` }}
          tabIndex={0}
          role="region"
          aria-label={`${t('preview')} — ${t(`device_${device}`)}`}
        >
          <div ref={contentRef} className="device-content">
            <MenuRenderer menu={menu} locale={locale} idPrefix="pv" onLocaleChange={setPreviewLocale} emptyHint={t('emptyMenu')} />
          </div>
        </div>
      </div>
    </div>
  );
}
