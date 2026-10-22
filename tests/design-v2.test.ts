import { describe, expect, it } from 'vitest';
import { parseMenu, designSchema, THEME_IDS } from '../src/core/schema';
import { createSampleMenu } from '../src/core/sample';
import { resolveDesign, surpriseDesign } from '../src/core/themes';
import { exportMenuHtml } from '../src/core/exportHtml';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('design 2.0', () => {
  it('still accepts menus saved before the new fields existed', () => {
    const legacy = JSON.parse(JSON.stringify(createSampleMenu()));
    delete legacy.design.heroStyle;
    delete legacy.design.pattern;
    const result = parseMenu(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const resolved = resolveDesign(result.menu.design);
      expect(resolved.heroStyle).toBe('overlay'); // noir-gold's signature
      expect(resolved.pattern).toBe('none');
    }
  });

  it('rejects unknown hero styles and patterns', () => {
    const m = createSampleMenu();
    expect(parseMenu({ ...m, design: { ...m.design, heroStyle: 'giant' } }).ok).toBe(false);
    expect(parseMenu({ ...m, design: { ...m.design, pattern: 'url(x)' } }).ok).toBe(false);
  });

  it('surprise always yields a valid design with a different theme', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let design = createSampleMenu().design;
    for (let i = 0; i < 200; i++) {
      const next = surpriseDesign(design, rand);
      expect(next.theme).not.toBe(design.theme);
      expect(designSchema.safeParse(next).success).toBe(true);
      expect(Object.values(next.effects).filter(Boolean).length).toBeGreaterThanOrEqual(1);
      design = next;
    }
  });

  it('every theme resolves a hero style and pattern', () => {
    for (const theme of THEME_IDS) {
      const r = resolveDesign(designSchema.parse({ theme }));
      expect(r.heroStyle).toBeTruthy();
      expect(r.pattern).toBeTruthy();
    }
  });

  it('exports section banners, patterns and decorative layers (hidden from AT)', async () => {
    const menu = createSampleMenu();
    menu.hero = { src: PIXEL, alt: { he: 'שער' } };
    menu.sections[0]!.image = { src: PIXEL, alt: { he: 'באנר' } };
    menu.design = { ...menu.design, theme: 'sunset', pattern: 'arabesque', effects: { bokeh: true, spotlight: true } };
    const html = await exportMenuHtml(menu, { embedFonts: false });
    expect(html).toContain('ma-hero-overlay');
    expect(html).toContain('class="ma-section-banner"');
    expect(html).toContain('alt="באנר"');
    expect(html).toMatch(/class="ma-pattern ma-pattern-arabesque" aria-hidden="true"/);
    expect(html).toMatch(/class="ma-bokeh" aria-hidden="true"/);
    expect(html).toMatch(/class="ma-spotlight" aria-hidden="true"/);
  });

  it('falls back to the classic hero when there is no cover image', async () => {
    const menu = createSampleMenu();
    menu.design = { ...menu.design, heroStyle: 'overlay' };
    const html = await exportMenuHtml(menu, { embedFonts: false });
    expect(html).toContain('ma-hero-classic');
    expect(html).not.toContain('ma-hero-overlay');
  });
});
