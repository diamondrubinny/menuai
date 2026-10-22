/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { CSSProperties } from 'react';
import type { Item, Menu, Section } from '../core/schema';
import { resolveDesign } from '../core/themes';
import { fontStack } from '../core/fonts';
import { t } from '../core/localize';
import { label } from '../core/labels';
import { formatPrice } from '../core/format';
import { getLocaleInfo } from '../core/locales';
import { isDark } from '../core/color';
import { BRAND, creditText } from '../core/brand';
import { ChiliIcon, OrnamentSvg, TagIcon } from './icons';

export interface MenuRendererProps {
  menu: Menu;
  locale: string;
  /** Prefix for element ids, so several renders (one per language) can live on one page. */
  idPrefix?: string;
  /**
   * 'react': language buttons call onLocaleChange (editor preview).
   * 'runtime': language buttons are handled by menuRuntime.js (exported file).
   */
  langMode?: 'react' | 'runtime';
  onLocaleChange?: (locale: string) => void;
  emptyHint?: string;
  hidden?: boolean;
}

const MOTION_EFFECTS = ['reveal', 'glow', 'aurora', 'tilt', 'shimmer', 'parallax', 'spotlight', 'bokeh', 'gradientBorder', 'kenBurns'] as const;

/** Deterministic layout for the bokeh lights (no randomness: stable SSR/export output). */
const BOKEH = [
  { x: 8, y: 6, s: 140, d: 0 }, { x: 78, y: 12, s: 220, d: -4 }, { x: 40, y: 28, s: 90, d: -9 },
  { x: 88, y: 41, s: 160, d: -2 }, { x: 14, y: 52, s: 200, d: -12 }, { x: 60, y: 63, s: 120, d: -6 },
  { x: 30, y: 78, s: 170, d: -15 }, { x: 82, y: 88, s: 110, d: -8 },
];

function listFormat(locale: string, values: string[]): string {
  try {
    return new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format(values);
  } catch {
    return values.join(', ');
  }
}

export function MenuRenderer({ menu, locale, idPrefix = 'ma', langMode = 'react', onLocaleChange, emptyHint, hidden }: MenuRendererProps) {
  const design = resolveDesign(menu.design);
  const { theme, palette, effects } = design;
  const fb = menu.defaultLocale;
  const tx = (v: Menu['title']) => t(v, locale, fb);
  const lb = (k: Parameters<typeof label>[2]) => label(menu, locale, k);
  const info = getLocaleInfo(locale);
  const credit = creditText(locale);

  const style = {
    '--ma-bg': palette.bg,
    '--ma-surface': palette.surface,
    '--ma-text': palette.text,
    '--ma-muted': palette.muted,
    '--ma-accent': palette.accent,
    '--ma-accent2': palette.accent2,
    '--ma-radius': `${design.radius}px`,
    '--ma-font-display': fontStack(design.fontDisplay, menu.locales),
    '--ma-font-body': fontStack(design.fontBody, menu.locales),
    '--ma-display-weight': String(theme.displayWeight),
    '--ma-scale': String(menu.design.scale),
  } as CSSProperties;

  const heroStyle = menu.hero ? design.heroStyle : 'classic';
  const fxClasses = (Object.keys(effects) as (keyof typeof effects)[]).filter((k) => effects[k]).map((k) => `fx-${k}`);
  const className = [
    'ma-menu',
    `ma-theme-${theme.id}`,
    `ma-layout-${design.layout}`,
    `ma-surface-${theme.surface}`,
    `ma-tex-${theme.texture}`,
    `ma-density-${menu.design.density}`,
    `ma-hero-${heroStyle}`,
    design.mode === 'alt' ? 'ma-mode-alt' : '',
    isDark(palette.bg) ? 'ma-dark' : 'ma-light',
    theme.headingCase === 'uppercase' ? 'ma-case-upper' : '',
    menu.design.stickyNav ? 'ma-sticky-nav' : '',
    ...fxClasses,
  ].filter(Boolean).join(' ');

  const sections = menu.sections
    .filter((s) => !s.hidden)
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden) }));
  const title = tx(menu.title);
  const subtitle = tx(menu.subtitle);
  const footer = tx(menu.footerNote);
  const hasMotion = MOTION_EFFECTS.some((k) => effects[k]);
  const showSwitcher = menu.design.showLanguageSwitcher && menu.locales.length > 1;
  const sectionId = (s: Section) => `${idPrefix}-${s.id}`;
  const price = (value: number) => formatPrice(value, locale, menu.currency);

  const renderItem = (item: Item, index: number) => {
    const name = tx(item.name);
    const desc = tx(item.description);
    const showImage = menu.design.showImages && item.image;
    const allergens = menu.design.showAllergens ? item.allergens.map((a) => lb(a)) : [];
    const singlePrice = item.variants.length === 0 && item.price !== undefined;
    return (
      <li
        key={item.id}
        className={`ma-item ma-reveal${item.soldOut ? ' ma-soldout' : ''}${showImage ? ' ma-has-image' : ''}${item.tags.includes('chefPick') ? ' ma-featured' : ''}`}
        style={{ '--ma-i': Math.min(index, 8) } as CSSProperties}
      >
        <div className="ma-item-inner">
          {showImage && item.image && (
            <div className="ma-item-media">
              <img src={item.image.src} alt={t(item.image.alt, locale, fb)} loading="lazy" decoding="async" />
            </div>
          )}
          <div className="ma-item-body">
            <div className="ma-item-head">
              <h3 className="ma-item-name">{name}</h3>
              {singlePrice && (
                <>
                  <span className="ma-leader" aria-hidden="true" />
                  <span className="ma-price">{price(item.price!)}</span>
                </>
              )}
            </div>
            {desc && <p className="ma-item-desc">{desc}</p>}
            {item.variants.length > 0 && (
              <ul className="ma-variants">
                {item.variants.map((v) => (
                  <li key={v.id} className="ma-variant">
                    <span className="ma-variant-label">{tx(v.label)}</span>
                    <span className="ma-leader" aria-hidden="true" />
                    <span className="ma-price">{price(v.price)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(item.tags.length > 0 || item.spicy > 0 || item.soldOut || item.calories !== undefined) && (
              <ul className="ma-badges">
                {item.soldOut && <li className="ma-badge ma-badge-soldout">{lb('soldOut')}</li>}
                {item.tags.map((tag) => (
                  <li key={tag} className={`ma-badge ma-badge-${tag}`}>
                    <TagIcon tag={tag} />
                    <span>{lb(tag)}</span>
                  </li>
                ))}
                {item.spicy > 0 && (
                  <li className="ma-badge ma-badge-spicy">
                    <span className="ma-chilis" aria-hidden="true">
                      {Array.from({ length: item.spicy }, (_, i) => <ChiliIcon key={i} />)}
                    </span>
                    <span>{lb('spicy')}{item.spicy > 1 ? ` ${item.spicy}/3` : ''}</span>
                  </li>
                )}
                {item.calories !== undefined && (
                  <li className="ma-badge ma-badge-kcal">{item.calories} {lb('calories')}</li>
                )}
              </ul>
            )}
            {allergens.length > 0 && (
              <p className="ma-allergens">
                <span className="ma-allergens-label">{lb('contains')}:</span> {listFormat(locale, allergens)}
              </p>
            )}
          </div>
        </div>
      </li>
    );
  };

  const titleText = title || ' ';

  return (
    <div
      className={className}
      style={style}
      lang={locale}
      dir={info.dir}
      data-ma-root=""
      data-ma-lang-root={langMode === 'runtime' ? locale : undefined}
      data-ma-title={langMode === 'runtime' ? title : undefined}
      hidden={hidden}
    >
      {effects.aurora && <div className="ma-aurora" aria-hidden="true"><span /><span /><span /></div>}
      {design.pattern !== 'none' && <div className={`ma-pattern ma-pattern-${design.pattern}`} aria-hidden="true" />}
      {effects.bokeh && (
        <div className="ma-bokeh" aria-hidden="true">
          {BOKEH.map((b, i) => (
            <span
              key={i}
              style={{ insetInlineStart: `${b.x}%`, top: `${b.y}%`, width: b.s, height: b.s, animationDelay: `${b.d}s` }}
            />
          ))}
        </div>
      )}
      {effects.spotlight && <div className="ma-spotlight" aria-hidden="true" />}
      {effects.grain && <div className="ma-grain" aria-hidden="true" />}

      <header className="ma-header">
        {menu.hero && (
          <div className="ma-hero">
            <img src={menu.hero.src} alt={t(menu.hero.alt, locale, fb)} decoding="async" />
          </div>
        )}
        <div className="ma-header-inner">
          {menu.logo && <img className="ma-logo" src={menu.logo.src} alt={t(menu.logo.alt, locale, fb)} />}
          <h1 className="ma-title" data-text={title}>{titleText}</h1>
          {subtitle && <p className="ma-subtitle">{subtitle}</p>}
          {effects.ornaments && <OrnamentSvg kind={theme.ornament === 'none' ? 'dots' : theme.ornament} />}
          {(showSwitcher || hasMotion) && (
            <div className="ma-toolbar">
              {showSwitcher && (
                <div className="ma-langs" role="group" aria-label={lb('language')}>
                  {menu.locales.map((code) => {
                    const li = getLocaleInfo(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        className="ma-lang"
                        lang={code}
                        dir={li.dir}
                        aria-pressed={code === locale}
                        data-ma-set-lang={code}
                        data-ma-runtime-lang={langMode === 'runtime' ? '' : undefined}
                        onClick={langMode === 'react' && onLocaleChange ? () => onLocaleChange(code) : undefined}
                      >
                        {li.nativeName}
                      </button>
                    );
                  })}
                </div>
              )}
              {hasMotion && (
                <button type="button" className="ma-motion-toggle" aria-pressed="false" data-ma-motion-toggle="" title={lb('reduceMotion')}>
                  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M9 7v10M15 7v10" />
                  </svg>
                  <span className="ma-sr">{lb('reduceMotion')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {menu.design.stickyNav && sections.length > 1 && (
        <nav className="ma-nav" aria-label={lb('sections')}>
          <ul className="ma-nav-list">
            {sections.map((s) => (
              <li key={s.id}>
                <a className="ma-nav-link" href={`#${sectionId(s)}`} data-ma-nav="">
                  {tx(s.title) || '•'}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <main className="ma-sections">
        {sections.length === 0 || sections.every((s) => s.items.length === 0 && !tx(s.title)) ? (
          emptyHint ? <p className="ma-empty">{emptyHint}</p> : null
        ) : (
          sections.map((s) => {
            const desc = tx(s.description);
            const banner = Boolean(s.image && menu.design.showImages);
            const head = (
              <header className="ma-section-head">
                <h2 className="ma-section-title" id={`${sectionId(s)}-h`} tabIndex={-1}>
                  <span>{tx(s.title)}</span>
                </h2>
                {desc && <p className="ma-section-desc">{desc}</p>}
              </header>
            );
            return (
              <section
                key={s.id}
                className={`ma-section${banner ? ' ma-has-banner' : ''}`}
                id={sectionId(s)}
                aria-labelledby={`${sectionId(s)}-h`}
              >
                {banner && s.image ? (
                  <div className="ma-section-cover">
                    <figure className="ma-section-banner">
                      <img src={s.image.src} alt={t(s.image.alt, locale, fb)} loading="lazy" decoding="async" />
                    </figure>
                    {head}
                  </div>
                ) : (
                  head
                )}
                <ul className="ma-items">{s.items.map(renderItem)}</ul>
              </section>
            );
          })
        )}
      </main>

      <footer className="ma-footer">
        {effects.ornaments && <OrnamentSvg kind={theme.ornament === 'none' ? 'dots' : theme.ornament} />}
        {footer && <p>{footer}</p>}
        {/* Attribution: always rendered, not configurable (see core/brand.ts and NOTICE). */}
        <p className="ma-credit" data-ma-credit="">
          {credit.poweredBy}{' '}
          <a href={BRAND.repo} target="_blank" rel="noopener noreferrer" lang="en" dir="ltr">
            {BRAND.name}
          </a>
          {' · '}
          {credit.openSource}
        </p>
      </footer>
    </div>
  );
}
