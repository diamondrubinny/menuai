/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Production CSP. Not applied in dev, where Vite injects inline scripts for hot reload. */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'menuai-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${APP_CSP}" />`);
    },
  };
}

// Local development: forward /api to the MenuAI server (npm run server:dev) so the editor and
// the API share one origin, exactly like production behind nginx.
const apiTarget = { target: process.env.MENUAI_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: false };
// The API, published menus (/m/<slug>) and uploaded images (/media/) all come from the MenuAI server.
const apiProxy = { '/api': apiTarget, '/m/': apiTarget, '/media/': apiTarget };

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Fonts must stay separate files so the exporter can fetch and embed them.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
