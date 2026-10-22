/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useMenuStore } from '../store/menuStore';
import { useEditorStore, type Tab } from '../store/editorStore';
import { useFeedback } from '../store/feedbackStore';
import { UI_LANGS, useT, useUiLang } from '../i18n/ui';
import { ContentPanel } from './panels/ContentPanel';
import { DesignPanel } from './panels/DesignPanel';
import { LanguagesPanel } from './panels/LanguagesPanel';
import { PublishPanel } from './panels/PublishPanel';
import { DevicePreview, PreviewToolbar } from './DevicePreview';
import { SiteFooter } from '../pages/SiteFooter';

const TABS: { id: Tab; key: 'tabContent' | 'tabDesign' | 'tabLanguages' | 'tabPublish' }[] = [
  { id: 'content', key: 'tabContent' },
  { id: 'design', key: 'tabDesign' },
  { id: 'languages', key: 'tabLanguages' },
  { id: 'publish', key: 'tabPublish' },
];

function isTextInput(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function Editor() {
  const { t } = useT();
  const undo = useMenuStore((s) => s.undo);
  const redo = useMenuStore((s) => s.redo);
  const canUndo = useMenuStore((s) => s.past.length > 0);
  const canRedo = useMenuStore((s) => s.future.length > 0);
  const saveStatus = useMenuStore((s) => s.saveStatus);
  const tab = useEditorStore((s) => s.tab);
  const setTab = useEditorStore((s) => s.setTab);
  const mobileView = useEditorStore((s) => s.mobileView);
  const setMobileView = useEditorStore((s) => s.setMobileView);
  const notify = useFeedback((s) => s.notify);
  const uiLang = useUiLang((s) => s.lang);
  const setUiLang = useUiLang((s) => s.setLang);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelRef = useRef<HTMLElement>(null);

  // Global undo / redo (text fields keep their native undo).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTextInput(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Surface storage problems once per kind.
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (saveStatus && !saveStatus.ok && lastError.current !== saveStatus.reason) {
      lastError.current = saveStatus.reason;
      notify(t(saveStatus.reason === 'quota' ? 'saveQuota' : 'saveUnavailable'), 'error');
    }
    if (saveStatus?.ok) lastError.current = null;
  }, [saveStatus, notify, t]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    let next = index;
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (index + 1) % TABS.length;
    else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    const target = TABS[next]!;
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  return (
    <div className="app" data-mobile-view={mobileView}>
      <a
        className="skip-link"
        href="#editor-panel"
        onClick={(e) => { e.preventDefault(); setMobileView('edit'); panelRef.current?.focus(); }}
      >
        {t('skipToEditor')}
      </a>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-text">
            <strong>{t('appName')}</strong>
            <span className="brand-tagline">{t('tagline')}</span>
          </span>
        </div>
        <div className="topbar-actions">
          <span className="save-status" aria-live="polite">
            {saveStatus?.ok ? `✓ ${t('saved')}` : ''}
          </span>
          <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label={t('undo')} title={`${t('undo')} (Ctrl+Z)`}>↶</button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} aria-label={t('redo')} title={`${t('redo')} (Ctrl+Shift+Z)`}>↷</button>
          <label className="inline-select">
            <span className="visually-hidden">{t('uiLanguage')}</span>
            <select value={uiLang} onChange={(e) => setUiLang(e.target.value)}>
              {UI_LANGS.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" id="editor-panel" ref={panelRef} tabIndex={-1} aria-label={t('editorPanels')}>
          <div className="tabs" role="tablist" aria-label={t('editorPanels')}>
            {TABS.map((item, index) => (
              <button
                key={item.id}
                ref={(el) => { tabRefs.current[item.id] = el; }}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(e) => onTabKey(e, index)}
              >
                {t(item.key)}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
            {tab === 'content' && <ContentPanel />}
            {tab === 'design' && <DesignPanel />}
            {tab === 'languages' && <LanguagesPanel />}
            {tab === 'publish' && <PublishPanel />}
          </div>
          <SiteFooter />
        </aside>

        <section className="preview" aria-label={t('preview')}>
          <PreviewToolbar />
          <DevicePreview />
        </section>
      </div>

      <nav className="mobile-switch" aria-label={`${t('edit')} / ${t('preview')}`}>
        <button type="button" aria-pressed={mobileView === 'edit'} onClick={() => setMobileView('edit')}>✎ {t('edit')}</button>
        <button type="button" aria-pressed={mobileView === 'preview'} onClick={() => setMobileView('preview')}>👁 {t('preview')}</button>
      </nav>
    </div>
  );
}
