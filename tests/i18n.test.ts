/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { describe, expect, it } from 'vitest';
import { UI_DICTS, translate } from '../src/i18n/ui';
import { BUILTIN_LABELS, label } from '../src/core/labels';
import { LABEL_KEYS } from '../src/core/schema';
import { t } from '../src/core/localize';
import { formatPrice } from '../src/core/format';
import { dirOf, getLocaleInfo } from '../src/core/locales';
import { fontChain, subsetsForLocales } from '../src/core/fonts';

describe('UI dictionaries', () => {
  const en = UI_DICTS.en!;
  for (const [lang, dict] of Object.entries(UI_DICTS)) {
    it(`${lang} has every key, non-empty, with the same placeholders`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe('');
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        expect(ph(value), key).toEqual(ph(en[key as keyof typeof en]));
      }
    });
  }

  it('interpolates variables', () => {
    expect(translate('en', 'translated', { percent: 50 })).toBe('50% translated');
  });
});

describe('menu labels', () => {
  for (const [lang, dict] of Object.entries(BUILTIN_LABELS)) {
    it(`${lang} labels are complete`, () => {
      for (const key of LABEL_KEYS) expect(dict[key], key).toBeTruthy();
    });
  }

  it('resolves override → built-in → base language → English', () => {
    expect(label({ labels: { he: { soldOut: 'נגמר' } } }, 'he', 'soldOut')).toBe('נגמר');
    expect(label({ labels: {} }, 'he', 'soldOut')).toBe('אזל');
    expect(label({ labels: {} }, 'pt-BR', 'soldOut')).toBe('Esgotado');
    expect(label({ labels: {} }, 'sw', 'soldOut')).toBe('Sold out');
  });
});

describe('localization helpers', () => {
  it('falls back to the default locale, then any value', () => {
    expect(t({ he: 'שלום', en: 'Hello' }, 'en', 'he')).toBe('Hello');
    expect(t({ he: 'שלום' }, 'en', 'he')).toBe('שלום');
    expect(t({ fr: 'Bonjour' }, 'en', 'he')).toBe('Bonjour');
    expect(t({ en: '   ' }, 'en', 'he')).toBe('');
  });

  it('detects text direction for known and unknown codes', () => {
    expect(dirOf('he')).toBe('rtl');
    expect(dirOf('ar-EG')).toBe('rtl');
    expect(dirOf('ckb')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(getLocaleInfo('pt-BR').nativeName).toBe('Português');
  });

  it('formats prices per locale', () => {
    expect(formatPrice(12.5, 'en', 'USD')).toBe('$12.5');
    expect(formatPrice(48, 'he', 'ILS')).toMatch(/48/);
    expect(formatPrice(10, 'en', 'NOPE')).toMatch(/10/);
  });

  it('adds script fallback fonts for languages the chosen font lacks', () => {
    expect(fontChain('playfair-display', ['he', 'ar'])).toEqual(['playfair-display', 'frank-ruhl-libre', 'amiri']);
    expect(fontChain('rubik', ['he', 'ar', 'ru'])).toEqual(['rubik']);
    expect(subsetsForLocales(['ru'])).toContain('cyrillic');
  });
});
