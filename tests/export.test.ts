import { describe, expect, it } from 'vitest';
import { escapeHtml, exportFileName, exportMenuHtml, minifyCss, runtimeScript, sha256Base64 } from '../src/core/exportHtml';
import { createSampleMenu } from '../src/core/sample';

const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';

describe('exportMenuHtml', () => {
  it('escapes user content everywhere (no script injection)', async () => {
    const menu = createSampleMenu();
    menu.title = { he: XSS, en: XSS, ar: XSS };
    menu.sections[0]!.items[0]!.name = { he: XSS };
    menu.sections[0]!.items[0]!.description = { he: '"><svg onload=alert(3)>' };
    const html = await exportMenuHtml(menu, { embedFonts: false });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('pins the only inline script with a matching CSP hash', async () => {
    const html = await exportMenuHtml(createSampleMenu(), { embedFonts: false });
    const hash = await sha256Base64(runtimeScript());
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain("default-src 'none'");
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(inline).toBe(runtimeScript());
  });

  it('contains every language, only the default one visible', async () => {
    const html = await exportMenuHtml(createSampleMenu(), { embedFonts: false });
    expect(html).toContain('<html lang="he" dir="rtl">');
    for (const lang of ['he', 'en', 'ar']) expect(html).toContain(`data-ma-lang-root="${lang}"`);
    expect(html.match(/data-ma-lang-root="[a-z]+"[^>]*hidden=""/g)).toHaveLength(2);
    expect(html).toContain('Lumière');
    expect(html).toContain('لوميير');
  });

  it('embeds fonts as data URLs when requested', async () => {
    const html = await exportMenuHtml(createSampleMenu(), { embedFonts: true, loadFont: async () => 'AAAA' });
    expect(html).toContain('src:url(data:font/woff2;base64,AAAA)');
    expect(html).toMatch(/font-family:"MA Heebo"/);
  });

  it('hides hidden sections and items', async () => {
    const menu = createSampleMenu();
    menu.sections[0]!.hidden = true;
    menu.sections[1]!.items[0]!.hidden = true;
    const html = await exportMenuHtml(menu, { embedFonts: false });
    expect(html).not.toContain('פוקאצ׳ה מהטאבון');
    expect(html).not.toContain('פילה לברק');
    expect(html).toContain('ריזוטו פטריות יער');
  });
});

describe('helpers', () => {
  it('escapeHtml escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('minifyCss keeps descendant combinators intact', () => {
    expect(minifyCss('.a  .b:hover { color: red; }\n/* c */')).toBe('.a .b:hover{color: red}');
  });

  it('builds safe file names', () => {
    expect(exportFileName(createSampleMenu(), 'html')).toBe('lumiere.html');
  });
});
