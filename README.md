# MenuAI

**Open-source, multilingual, designer-grade menu builder.** Build a restaurant / café / bar menu in any language (full RTL), pick one of 12 studio themes, layer effects (glass, neon, aurora, grain, 3D tilt, shimmer, parallax…), preview it on phone, tablet, desktop and TV, then export **one self-contained HTML file**, print an A4 PDF or generate a QR code.

> 🇮🇱 **בעברית:** מערכת קוד פתוח לבניית תפריטים מעוצבים בכל שפה (כולל RTL מלא), עם 12 ערכות עיצוב, 10 אפקטים, 4 פריסות ותצוגה מקדימה לנייד/טאבלט/מחשב/טלוויזיה. מייצאים קובץ HTML אחד שעובד בכל אחסון, מדפיסים ל־PDF או מפיקים קוד QR. אפיון ותוכנית: [`docs/PLAN.md`](docs/PLAN.md).

## Features

| Area | What you get |
|---|---|
| Content | Sections, items, descriptions, prices, price variants (sizes), images, tags (vegan, chef's pick…), the 14 EU allergens, spiciness, calories, sold-out, hidden |
| Languages | 33 languages in the picker + any BCP-47 code; per-field translations with fallback; RTL (he, ar, fa, ur, yi…); translation progress; editable menu labels per language; guests' browser language auto-selected in exported menus |
| Design | 12 themes (Noir & Gold, Ivory Bistro, Chalkboard, Neon Night, Aurora Glass, Nordic Minimal, Terracotta, Matcha Zen, Ocean Breeze, Desert Souk, Retro Diner, Garden Brunch), 4 layouts (list, cards, magazine, showcase), custom colors with live contrast warnings, 12 self-hosted fonts with automatic Hebrew/Arabic/Cyrillic fallbacks, radius, density, text size |
| Effects | Reveal on scroll, glassmorphism, neon glow, aurora, film grain, 3D tilt, shimmer, parallax (scroll-driven), dot leaders, ornaments — all disabled for `prefers-reduced-motion` and via a "reduce motion" button on the menu |
| Screens | Container-query layouts: the preview of a tablet behaves exactly like a tablet. Phone / tablet (rotate) / desktop / TV-kiosk previews, full-screen view, A4 print stylesheet |
| Publishing | Single-file HTML export (fonts + images embedded, strict CSP with script hash, no external requests), print/PDF, QR code (SVG), JSON backup/import |
| Editor | Undo/redo (Ctrl+Z / Ctrl+Shift+Z), autosave in the browser, Hebrew / English / Arabic UI, mobile-friendly editor |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build on :4173 |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end + axe accessibility tests (Playwright; builds first) |
| `npm run audit:deps` | Known-vulnerability check for runtime dependencies |
| `node scripts/gen-fonts.mjs` | Regenerate the font registry after adding a `@fontsource` family |

Requirements: Node.js ≥ 20. No environment variables or secrets are needed (see `.env.example`).

## Deploy the editor

`npm run build` produces a static site in `dist/` that works on any static host (relative paths, hash routing — no rewrites needed).

- **Netlify / Cloudflare Pages:** build command `npm run build`, output `dist`. `public/_headers` adds HSTS, CSP, `X-Frame-Options`, `Permissions-Policy`, etc.
- **GitHub Pages / nginx / Apache:** upload `dist/` and configure equivalent headers (see `public/_headers`).
- The build also injects a `<meta>` CSP into `index.html`.

## Publishing a menu

1. **Publish → Download menu (HTML)** — one file containing every language.
2. Upload it anywhere (as `index.html` in its own folder/site).
3. Paste its `https://` address in **Publish → QR code** and print the QR for the tables.

Exported files have no cookies, trackers, or third-party requests (unless you used external image *links* instead of uploads).

## Architecture

```
src/
  core/        pure logic: zod schema, themes, fonts, labels, i18n helpers, images, storage, HTML export
  renderer/    MenuRenderer (React, shared by preview + export) and menuRuntime.js (vanilla, inlined in exports)
  store/       zustand stores: menu (undo/redo + autosave), editor UI, feedback
  editor/      editor shell, panels, fields, device preview
  pages/       full-screen view, accessibility statement, privacy, 404
  styles/      menu.css (themes, layouts, effects) and app.css (editor)
tests/         unit tests        e2e/  Playwright + axe
```

Full specification, data model, threat model and roadmap: [`docs/PLAN.md`](docs/PLAN.md). Pre-launch checklist: [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md).

### Adding a theme

1. Add the id to `THEME_IDS` in `src/core/schema.ts`.
2. Define it in `src/core/themes.ts` (palette, fonts, layout, surface, texture, ornament, default effects).
3. Optionally add signature rules under `.ma-theme-<id>` in `src/styles/menu.css`.
4. `npm test` verifies every palette meets WCAG AA contrast.

## Security, privacy & accessibility

- Security model and reporting: [`SECURITY.md`](SECURITY.md).
- Privacy: everything stays in the user's browser; no cookies, analytics or third parties → no consent banner needed for the editor in its current form. Drafts: in-app `#/privacy`, [`docs/legal/`](docs/legal/). **Legal review required before commercial use.**
- Accessibility target: WCAG 2.1 AA / IS 5568, verified by axe in CI on the editor, every theme and the exported file. Statement draft: in-app `#/accessibility`. Automated tests do not replace manual screen-reader testing.

## Licenses

Code: [MIT](LICENSE). Fonts: bundled from [Fontsource](https://fontsource.org) under the SIL Open Font License 1.1, which permits embedding them in exported menus.
