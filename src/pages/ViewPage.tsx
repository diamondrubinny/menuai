import { useEffect, useRef, useState } from 'react';
import { useMenuStore } from '../store/menuStore';
import { MenuRenderer } from '../renderer/MenuRenderer';
import { initMenuRuntime } from '../renderer/menuRuntime.js';
import { getLocaleInfo } from '../core/locales';
import { t as tx } from '../core/localize';
import type { Route } from '../router';

/** Full-screen menu (kiosk / table tablet / print). */
export function ViewPage({ route }: { route: Route }) {
  const menu = useMenuStore((s) => s.menu);
  const requested = route.params.get('lang');
  const [locale, setLocale] = useState(requested && menu.locales.includes(requested) ? requested : menu.defaultLocale);
  const ref = useRef<HTMLDivElement>(null);
  const print = route.params.get('print') === '1';

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = getLocaleInfo(locale).dir;
    document.title = tx(menu.title, locale, menu.defaultLocale) || 'Menu';
  }, [locale, menu]);

  useEffect(() => {
    if (!ref.current) return;
    const runtime = initMenuRuntime(ref.current);
    return () => runtime.destroy();
  }, [locale]);

  useEffect(() => {
    if (!print) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      // Let images decode before opening the print dialog.
      setTimeout(() => { if (!cancelled) window.print(); }, 400);
    });
    return () => { cancelled = true; };
  }, [print]);

  return (
    <div ref={ref} className="view-page">
      <MenuRenderer menu={menu} locale={locale} idPrefix="view" onLocaleChange={setLocale} />
    </div>
  );
}
