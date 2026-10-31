/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initTablePay } from '../src/renderer/tablePay.js';
import { exportMenuHtml, runtimeScript } from '../src/core/exportHtml';
import { createSampleMenu } from '../src/core/sample';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

function visit(path: string) {
  window.history.replaceState(null, '', path);
}

describe('pay-the-bill button on a published menu opened from a table', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div data-ma-lang-root="he"></div><div data-ma-lang-root="en" hidden></div>';
    document.body.className = '';
    document.documentElement.lang = 'he';
    sessionStorage.clear();
  });
  afterEach(() => visit('/'));

  it('links back to the table page in the menu language, and hides the code from the address', () => {
    visit(`/m/lumiere?lang=he#table=${CODE}`);
    const link = initTablePay(document)!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(`/t/${CODE}?lang=he`);
    expect(link.textContent).toContain('תשלום החשבון');
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('💳');
    expect(document.body.classList.contains('ma-has-pay')).toBe(true);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?lang=he');
  });

  it('follows the menu language when the guest switches it', async () => {
    visit(`/m/lumiere#table=${CODE}`);
    const link = initTablePay(document)!;
    document.documentElement.lang = 'ar';
    await new Promise((r) => setTimeout(r, 0));
    expect(link.textContent).toContain('دفع الحساب');
    expect(link.getAttribute('href')).toBe(`/t/${CODE}?lang=ar`);
    document.documentElement.lang = 'fr';
    await new Promise((r) => setTimeout(r, 0));
    expect(link.textContent).toContain('Pay the bill');
    expect(link.getAttribute('lang')).toBe('en');
  });

  it('survives a reload in the same tab (the code was kept for this tab only)', () => {
    visit(`/m/lumiere#table=${CODE}`);
    initTablePay(document);
    document.body.innerHTML = '<div data-ma-lang-root="he"></div>';
    visit('/m/lumiere#starters');
    expect(initTablePay(document)?.getAttribute('href')).toBe(`/t/${CODE}?lang=he`);
  });

  it('does nothing without a valid table code, or outside server-published menus', () => {
    visit('/m/lumiere');
    expect(initTablePay(document)).toBeNull();
    visit('/m/lumiere#table=short');
    expect(initTablePay(document)).toBeNull();
    visit(`/m/lumiere#table=${CODE}"><img src=x>`);
    expect(initTablePay(document)).toBeNull();
    visit(`/menu.html#table=${CODE}`); // a downloaded/exported file: no server to pay through
    expect(initTablePay(document)).toBeNull();
    expect(document.querySelector('.ma-pay')).toBeNull();
  });

  it('ships inside the published menu script, which stays the single hashed inline script', async () => {
    expect(runtimeScript()).toContain('initTablePay(document)');
    expect(runtimeScript()).not.toMatch(/^\s*export /m);
    const html = await exportMenuHtml(createSampleMenu(), { embedFonts: false });
    expect(html.match(/<script>/g)).toHaveLength(1);
    // (Its styles are checked on a real published page in server/test/payments.test.ts: CSS imports are empty under jsdom.)
  });
});
