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

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
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
