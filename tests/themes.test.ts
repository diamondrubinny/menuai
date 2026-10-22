import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/core/themes';
import { AA_TEXT, contrastRatio } from '../src/core/color';
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
});
