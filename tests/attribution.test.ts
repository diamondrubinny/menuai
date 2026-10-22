/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { checkAttribution } from '../scripts/check-attribution.mjs';
import { BRAND, CREDIT_LINE, creditText } from '../src/core/brand';
import { MenuRenderer } from '../src/renderer/MenuRenderer';
import { createSampleMenu } from '../src/core/sample';
import { exportMenuHtml } from '../src/core/exportHtml';
import { LOCALES } from '../src/core/locales';
import { LABEL_KEYS } from '../src/core/schema';
import { loginMail } from '../server/src/mail/templates';

describe('attribution', () => {
  it('is intact in this repository', () => {
    expect(checkAttribution('.')).toEqual([]);
  });

  it('the check catches a stripped header and a removed visible credit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'menuai-attr-'));
    try {
      for (const p of ['src', 'server', 'scripts', 'tests', 'e2e', 'LICENSE', 'NOTICE', 'index.html', 'vite.config.ts', 'playwright.config.ts']) {
        cpSync(p, join(dir, p), { recursive: true });
      }
      const file = join(dir, 'src/core/ids.ts');
      writeFileSync(file, readFileSync(file, 'utf8').replace(/^\/\*![\s\S]*?\*\/\n/, ''));
      const renderer = join(dir, 'src/renderer/MenuRenderer.tsx');
      writeFileSync(renderer, readFileSync(renderer, 'utf8').replaceAll('data-ma-credit', 'data-x'));
      const problems = checkAttribution(dir);
      expect(problems.some((p) => p.includes('src/core/ids.ts'))).toBe(true);
      expect(problems.some((p) => p.includes('MenuRenderer.tsx') && p.includes('data-ma-credit'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every menu shows "Powered by MenuAI · Open source" in every language, linked to the project', () => {
    const menu = createSampleMenu();
    for (const { code } of [...LOCALES, { code: 'sw' }, { code: 'pt-BR' }]) {
      const html = renderToStaticMarkup(createElement(MenuRenderer, { menu, locale: code }));
      const credit = creditText(code);
      expect(html, code).toContain('data-ma-credit');
      expect(html, code).toContain(`href="${BRAND.repo}"`);
      expect(html, code).toContain(credit.poweredBy);
      expect(html, code).toContain(credit.openSource);
    }
  });

  it('cannot be blanked through menu settings or label overrides', () => {
    const menu = createSampleMenu();
    menu.labels = { he: Object.fromEntries(LABEL_KEYS.map((k) => [k, ' '])) };
    menu.footerNote = {};
    menu.sections = [];
    menu.design = { ...menu.design, effects: { ornaments: false } };
    const html = renderToStaticMarkup(createElement(MenuRenderer, { menu, locale: 'he' }));
    expect(html).toContain('מופעל על ידי');
    expect(html).toContain('>MenuAI</a>');
  });

  it('exported files carry the visible credit, a header comment, generator meta and the CSS notice', async () => {
    const html = await exportMenuHtml(createSampleMenu(), { embedFonts: false });
    expect(html.indexOf('Made with MenuAI')).toBeLessThan(html.indexOf('<html'));
    expect(html).toContain(`<meta name="generator" content="MenuAI (open source, AGPL-3.0) ${BRAND.repo}">`);
    expect(html.match(/data-ma-credit/g)).toHaveLength(3); // one per language block
    expect(html).toMatch(/\/\*! @license[\s\S]*Powered by MenuAI/);
  });

  it('emails and server output carry the credit line', () => {
    expect(loginMail('a@example.com', 'https://x/#/login?token=t', 'login', 15).text).toContain(CREDIT_LINE);
    expect(CREDIT_LINE).toBe(`Powered by MenuAI · Open source (AGPL-3.0) · ${BRAND.repo}`);
  });
});
