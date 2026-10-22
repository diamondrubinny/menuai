import { describe, expect, it } from 'vitest';
import { THEMES, deriveAltPalette } from '../src/core/themes';
import { AA_TEXT, contrastRatio, isDark } from '../src/core/color';
import { THEME_IDS } from '../src/core/schema';

describe('themes', () => {
  it('defines every theme id', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
  });

  for (const theme of Object.values(THEMES)) {
    describe(theme.id, () => {
      const { bg, surface, text, muted, accent } = theme.palette;
      for (const [fgName, fg] of Object.entries({ text, muted, accent })) {
        for (const [bgName, background] of Object.entries({ bg, surface })) {
          it(`${fgName} on ${bgName} meets WCAG AA`, () => {
            expect(contrastRatio(fg, background)).toBeGreaterThanOrEqual(AA_TEXT);
          });
        }
      }
    });
  }

  for (const theme of Object.values(THEMES)) {
    it(`${theme.id} alt palette meets WCAG AA and flips light/dark`, () => {
      const alt = deriveAltPalette(theme.palette);
      for (const fg of [alt.text, alt.muted, alt.accent]) {
        for (const bg of [alt.bg, alt.surface]) {
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
      expect(isDark(alt.bg)).toBe(!isDark(theme.palette.bg));
    });
  }
});
