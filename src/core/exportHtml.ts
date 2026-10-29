/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import menuCss from '../styles/menu.css?raw';
import runtimeSource from '../renderer/menuRuntime.js?raw';
import tablePaySource from '../renderer/tablePay.js?raw';
import { MenuRenderer } from '../renderer/MenuRenderer';
import { MEDIA_SRC_RE, type Menu } from './schema';
import { mapMenuImages } from './menuImages';
import { resolveDesign } from './themes';
import { fontFaceCss, requiredFontFiles } from './fonts';
import type { FontFile } from './fontFiles.generated';
import { t } from './localize';
import { dirOf } from './locales';
import { luminance } from './color';
import { BRAND, CREDIT_COMMENT } from './brand';

export interface ExportOptions {
  /** Embed the needed font files as base64 (self-contained, ~100–400 KB). */
  embedFonts: boolean;
  /** Override font loading (tests / Node). Returns base64 for a font file. */
  loadFont?: (file: FontFile) => Promise<string>;
  /**
   * Images uploaded to the MenuAI server (`/media/…`): `inline` embeds them (a downloaded file must work
   * anywhere, default); `link` keeps the same-origin URL (menus published by that server).
   */
  media?: 'inline' | 'link';
  /** Override loading of `/media/…` images for `inline` (tests). Returns base64 WebP. */
  loadMedia?: (src: string) => Promise<string>;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function minifyCss(css: string): string {
  return css
    // Strip comments, but keep /*! … */ license notices (attribution).
    .replace(/\/\*(?!!)[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fetchMediaBase64(src: string): Promise<string> {
  const res = await fetch(src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Image download failed: ${src}`);
  return toBase64(await res.arrayBuffer());
}

async function fetchFontBase64(file: FontFile): Promise<string> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`Font download failed: ${file.url}`);
  return toBase64(await res.arrayBuffer());
}

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toBase64(digest);
}

export function runtimeScript(): string {
  const body = runtimeSource.replace(/^export\s+function/m, 'function');
  // The pay button only appears on menus served from a MenuAI server (/m/…) opened from a table page.
  const pay = tablePaySource.replace(/^\/\*![\s\S]*?\*\/\s*/, '').replace(/^export\s+function/m, 'function');
  return `(function(){${body}\ninitMenuRuntime(document.body,{syncUrl:true});\n${pay}\ninitTablePay(document);})();`;
}

/** Builds a single, self-contained HTML file with every language of the menu. */
export async function exportMenuHtml(source: Menu, options: ExportOptions): Promise<string> {
  const mediaMode = options.media ?? 'inline';
  const loadMedia = options.loadMedia ?? fetchMediaBase64;
  const menu =
    mediaMode === 'inline'
      ? await mapMenuImages(source, async (src) => (MEDIA_SRC_RE.test(src) ? `data:image/webp;base64,${await loadMedia(src)}` : src))
      : source;
  const design = resolveDesign(menu.design);
  const locale = menu.defaultLocale;
  const title = t(menu.title, locale, locale) || 'Menu';
  const description = t(menu.subtitle, locale, locale);

  let fontCss = '';
  if (options.embedFonts) {
    const files = requiredFontFiles([design.fontDisplay, design.fontBody], menu.locales);
    const load = options.loadFont ?? fetchFontBase64;
    const data = await Promise.all(files.map(async (f) => [f, await load(f)] as const));
    const map = new Map(data);
    fontCss = fontFaceCss(files, (f) => `data:font/woff2;base64,${map.get(f)}`);
  }

  const ordered = [menu.defaultLocale, ...menu.locales.filter((l) => l !== menu.defaultLocale)];
  const bodies = ordered
    .map((code) =>
      renderToStaticMarkup(
        createElement(MenuRenderer, {
          menu,
          locale: code,
          idPrefix: `ma-${code}`,
          langMode: 'runtime',
          hidden: code !== menu.defaultLocale,
        }),
      ),
    )
    .join('\n');

  const script = runtimeScript();
  const scriptHash = await sha256Base64(script);
  const csp = [
    "default-src 'none'",
    mediaMode === 'link' ? "img-src 'self' data: https:" : 'img-src data: https:',
    "style-src 'unsafe-inline'",
    'font-src data:',
    `script-src 'sha256-${scriptHash}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const dark = luminance(design.palette.bg) < 0.2;

  return `<!doctype html>
${CREDIT_COMMENT}
<html lang="${escapeHtml(locale)}" dir="${dirOf(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:,">
<meta name="color-scheme" content="${dark ? 'dark' : 'light'}">
<meta name="theme-color" content="${escapeHtml(design.palette.bg)}">
<meta name="generator" content="${BRAND.name} (open source, ${BRAND.license}) ${BRAND.repo}">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n<meta property="og:description" content="${escapeHtml(description)}">\n` : ''}<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:type" content="website">
<style>${fontCss}
html,body{margin:0;min-height:100%;background:${design.palette.bg}}
${minifyCss(menuCss)}</style>
</head>
<body>
${bodies}
<script>${script}</script>
</body>
</html>
`;
}

export function exportFileName(menu: Menu, ext: 'html' | 'json'): string {
  const base = t(menu.title, 'en', menu.defaultLocale) || 'menu';
  const slug = base
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return `${slug || 'menu'}.${ext}`;
}

export function downloadText(content: string, fileName: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
