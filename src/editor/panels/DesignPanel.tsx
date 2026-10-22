import { useId } from 'react';
import { useMenuStore } from '../../store/menuStore';
import { useT } from '../../i18n/ui';
import { EFFECTS, FONT_IDS, LAYOUTS, PALETTE_KEYS, THEME_IDS, type Design, type FontId, type PaletteKey } from '../../core/schema';
import { THEMES, resolveDesign } from '../../core/themes';
import { FONTS } from '../../core/fonts';
import { AA_TEXT, contrastRatio } from '../../core/color';
import { Fieldset, Toggle } from '../fields/Fields';

export function DesignPanel() {
  const design = useMenuStore((s) => s.menu.design);
  const setDesign = useMenuStore((s) => s.setDesign);
  const setTheme = useMenuStore((s) => s.setTheme);
  const { t, lang } = useT();
  const resolved = resolveDesign(design);
  const themeName = (id: keyof typeof THEMES) => THEMES[id].name[lang as 'he' | 'en' | 'ar'] ?? THEMES[id].name.en;

  return (
    <div className="panel-stack">
      <Fieldset legend={t('theme')}>
        <div className="theme-grid">
          {THEME_IDS.map((id) => {
            const theme = THEMES[id];
            const p = theme.palette;
            return (
              <label key={id} className="theme-card">
                <input type="radio" name="theme" className="visually-hidden" checked={design.theme === id} onChange={() => setTheme(id)} />
                <span
                  className="theme-swatch"
                  aria-hidden="true"
                  style={{ background: p.bg, color: p.text, borderRadius: Math.min(theme.radius, 12) }}
                >
                  <span className="theme-swatch-title" style={{ color: p.accent, fontFamily: `"${FONTS[theme.fontDisplay].family}", "${FONTS.heebo.family}", serif` }}>
                    Aa אב
                  </span>
                  {[0.7, 0.5].map((w, i) => (
                    <span key={i} className="theme-swatch-row">
                      <i style={{ background: p.text, width: `${w * 100}%` }} />
                      <b style={{ borderColor: p.muted }} />
                      <i style={{ background: p.accent, width: '14%' }} />
                    </span>
                  ))}
                  <span className="theme-swatch-dots">
                    {[p.surface, p.accent2].map((c, i) => <i key={i} style={{ background: c }} />)}
                  </span>
                </span>
                <span className="theme-name">{themeName(id)}</span>
              </label>
            );
          })}
        </div>
      </Fieldset>

      <Fieldset legend={t('layout')} className="chips">
        {LAYOUTS.map((layout) => (
          <label key={layout} className="chip">
            <input type="radio" name="layout" checked={design.layout === layout} onChange={() => setDesign({ layout })} />
            <span>{t(`layout_${layout}`)}</span>
          </label>
        ))}
      </Fieldset>

      <Fieldset legend={t('colors')}>
        <div className="color-grid">
          {PALETTE_KEYS.map((key) => (
            <ColorInput
              key={key}
              label={t(`color_${key}`)}
              value={resolved.palette[key]}
              overridden={Boolean(design.palette[key])}
              onChange={(value) => setDesign({ palette: { ...design.palette, [key]: value } }, `palette.${key}`)}
            />
          ))}
        </div>
        <ContrastWarnings palette={resolved.palette} />
        {Object.keys(design.palette).length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDesign({ palette: {} })}>
            {t('resetColors')}
          </button>
        )}
      </Fieldset>

      <Fieldset legend={t('typography')}>
        <FontSelect label={t('fontDisplay')} value={design.fontDisplay} themeFont={THEMES[design.theme].fontDisplay} onChange={(fontDisplay) => setDesign({ fontDisplay })} />
        <FontSelect label={t('fontBody')} value={design.fontBody} themeFont={THEMES[design.theme].fontBody} onChange={(fontBody) => setDesign({ fontBody })} />
        <Range label={t('scale')} min={0.85} max={1.3} step={0.05} value={design.scale} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => setDesign({ scale }, 'scale')} />
        <Range label={t('radius')} min={0} max={32} step={1} value={resolved.radius} format={(v) => `${v}px`} onChange={(radius) => setDesign({ radius }, 'radius')} />
        <div className="chips" role="radiogroup" aria-label={t('density')}>
          <span className="chips-label" aria-hidden="true">{t('density')}</span>
          {(['compact', 'cozy', 'airy'] as const).map((density) => (
            <label key={density} className="chip">
              <input type="radio" name="density" checked={design.density === density} onChange={() => setDesign({ density })} />
              <span>{t(`density_${density}`)}</span>
            </label>
          ))}
        </div>
      </Fieldset>

      <Fieldset legend={t('effects')}>
        <div className="toggle-list">
          {EFFECTS.map((fx) => (
            <Toggle
              key={fx}
              label={t(`fx_${fx}`)}
              description={t(`fx_${fx}_d`)}
              checked={resolved.effects[fx]}
              onChange={(on) => setDesign({ effects: { ...design.effects, [fx]: on } })}
            />
          ))}
        </div>
        <p className="hint">{t('motionNote')}</p>
      </Fieldset>

      <Fieldset legend={t('display')}>
        <div className="toggle-list">
          {(['showImages', 'showAllergens', 'showLanguageSwitcher', 'stickyNav'] as const).map((key) => (
            <Toggle key={key} label={t(key)} checked={design[key]} onChange={(v) => setDesign({ [key]: v } as Partial<Design>)} />
          ))}
        </div>
      </Fieldset>
    </div>
  );
}

function ColorInput({ label, value, overridden, onChange }: { label: string; value: string; overridden: boolean; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className={`color-input${overridden ? ' is-overridden' : ''}`}>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      <label htmlFor={id}>
        {label}
        <span className="color-hex" dir="ltr">{value}</span>
      </label>
    </div>
  );
}

function ContrastWarnings({ palette }: { palette: Record<PaletteKey, string> }) {
  const { t } = useT();
  const pairs: [PaletteKey, PaletteKey][] = [
    ['text', 'bg'], ['muted', 'bg'], ['accent', 'bg'], ['text', 'surface'], ['muted', 'surface'], ['accent', 'surface'],
  ];
  const problems = pairs
    .map(([fg, bg]) => ({ fg, bg, ratio: contrastRatio(palette[fg], palette[bg]) }))
    .filter((p) => p.ratio < AA_TEXT);
  if (problems.length === 0) return null;
  return (
    <ul className="warnings" aria-live="polite">
      {problems.map((p) => (
        <li key={`${p.fg}-${p.bg}`} className="hint hint-warn">
          {t('contrastWarning', { fg: t(`color_${p.fg}`), bg: t(`color_${p.bg}`), ratio: p.ratio.toFixed(1) })}
        </li>
      ))}
    </ul>
  );
}

function FontSelect({ label, value, themeFont, onChange }: { label: string; value: FontId | undefined; themeFont: FontId; onChange: (v: FontId | undefined) => void }) {
  const id = useId();
  const { t } = useT();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as FontId | undefined)}>
        <option value="">{t('themeDefault', { name: FONTS[themeFont].label })}</option>
        {FONT_IDS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: `"${FONTS[f].family}"` }}>
            {FONTS[f].label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Range({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="field range-field">
      <label htmlFor={id}>
        {label} <output htmlFor={id} dir="ltr">{format(value)}</output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
