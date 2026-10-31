/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportMenuHtml, runtimeScript, sha256Base64 } from '../../../src/core/exportHtml';
import type { FontFile } from '../../../src/core/fontFiles.generated';
import type { Menu } from '../../../src/core/schema';

/**
 * Where a font file lives on disk. In the bundle, `?url` imports are paths relative to the bundle
 * (`./fonts/…`, see scripts/build-server.mjs); under Vite/Vitest they are root-relative
 * (`/node_modules/…` or `/@fs/<absolute>`).
 */
export function fontPath(url: string): string {
  if (url.startsWith('./') || url.startsWith('../')) return fileURLToPath(new URL(url, import.meta.url));
  if (url.startsWith('/@fs/')) return url.slice('/@fs'.length);
  return path.join(process.cwd(), url);
}

const fontCache = new Map<string, Promise<string>>();

/** Reads (once) and base64-encodes a bundled font file. Font URLs come from our own registry, never from users. */
export function readFontBase64(file: FontFile): Promise<string> {
  let cached = fontCache.get(file.url);
  if (!cached) {
    cached = readFile(fontPath(file.url)).then((b) => b.toString('base64'));
    cached.catch(() => fontCache.delete(file.url));
    fontCache.set(file.url, cached);
  }
  return cached;
}

/** Renders a validated menu into the same self-contained HTML file the editor exports. */
export function renderPublishedMenu(menu: Menu): Promise<string> {
  return exportMenuHtml(menu, { embedFonts: true, loadFont: readFontBase64, media: 'link' });
}

let cspPromise: Promise<string> | undefined;

/**
 * CSP header for published menus. The page's runtime script is the same for every menu, so its hash
 * is computed once. Only that hashed script can run, and `connect-src 'self'` lets it (the table cart,
 * tableOrder.js) reach this server's guest order endpoints; it never reaches other origins.
 */
export function publishedMenuCsp(): Promise<string> {
  cspPromise ??= sha256Base64(runtimeScript()).then((hash) =>
    [
      "default-src 'none'",
      "img-src 'self' data: https:",
      "style-src 'unsafe-inline'",
      'font-src data:',
      `script-src 'sha256-${hash}'`,
      // The table cart (tableOrder.js) reads and sends orders to this server only.
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  return cspPromise;
}
