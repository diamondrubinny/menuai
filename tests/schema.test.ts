/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { describe, expect, it } from 'vitest';
import { parseMenu, parseMenuJson, LIMITS } from '../src/core/schema';
import { createEmptyMenu, createSampleMenu } from '../src/core/sample';

describe('menu schema', () => {
  it('accepts the sample and empty menus', () => {
    expect(parseMenu(createSampleMenu()).ok).toBe(true);
    expect(parseMenu(createEmptyMenu('en')).ok).toBe(true);
  });

  it('round-trips through JSON', () => {
    const menu = createSampleMenu();
    const result = parseMenuJson(JSON.stringify(menu));
    expect(result.ok && result.menu).toEqual(menu);
  });

  it('rejects malformed JSON and oversized input without throwing', () => {
    expect(parseMenuJson('{not json').ok).toBe(false);
    expect(parseMenuJson(' '.repeat(LIMITS.importBytes + 1)).ok).toBe(false);
  });

  it('rejects a default locale that is not in locales', () => {
    expect(parseMenu({ ...createSampleMenu(), defaultLocale: 'fr' }).ok).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'http://insecure.example/a.png',
    'https://x.example/a.png" onerror="alert(1)',
  ])('rejects unsafe image src %s', (src) => {
    expect(parseMenu({ ...createSampleMenu(), logo: { src, alt: {} } }).ok).toBe(false);
  });

  it('accepts https and raster data URLs', () => {
    expect(parseMenu({ ...createSampleMenu(), logo: { src: 'https://cdn.example.com/logo.png', alt: {} } }).ok).toBe(true);
    expect(parseMenu({ ...createSampleMenu(), logo: { src: 'data:image/webp;base64,UklGRg==', alt: {} } }).ok).toBe(true);
  });

  it('never carries a __proto__ key into the parsed menu', () => {
    const menu = JSON.parse(JSON.stringify(createSampleMenu()));
    menu.title = JSON.parse('{"__proto__": {"polluted": true}, "he": "x"}');
    const result = parseMenu(menu);
    expect(result.ok && Object.keys(result.menu.title)).toEqual(['he']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects invalid locale codes', () => {
    expect(parseMenu({ ...createSampleMenu(), locales: ['he', 'en', 'ar', '<x>'] }).ok).toBe(false);
  });

  it('rejects invalid colors and out-of-range numbers', () => {
    const m = createSampleMenu();
    expect(parseMenu({ ...m, design: { ...m.design, palette: { bg: 'red;}' } } }).ok).toBe(false);
    expect(parseMenu({ ...m, design: { ...m.design, scale: 5 } }).ok).toBe(false);
  });
});
