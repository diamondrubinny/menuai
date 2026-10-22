# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(Security → "Report a vulnerability") on this repository. We aim to respond within 7 days.

## Security model (Phase 1)

MenuAI Phase 1 is a static, client-only application: there is no server, account system or database.

| Control | Where |
|---|---|
| All imported / stored data validated with a strict zod schema (size limits, enums, regex for ids, colors, locale codes, image sources) | `src/core/schema.ts` |
| Images: PNG/JPEG/WebP only, magic-byte sniffing, decode + **re-encode through canvas** (strips EXIF/GPS and embedded payloads), size limits; SVG/HTML/`javascript:` rejected | `src/core/images.ts` |
| No `dangerouslySetInnerHTML` with user content; exports rendered with `renderToStaticMarkup` (escaped) | `src/renderer`, `src/core/exportHtml.ts` |
| Exported files: `default-src 'none'`, single inline script pinned by SHA-256, `base-uri 'none'`, `form-action 'none'`, no external requests | `src/core/exportHtml.ts` |
| Editor CSP (meta at build time + `_headers`), HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Permissions-Policy` | `vite.config.ts`, `public/_headers` |
| No secrets in the codebase; nothing to configure | `.env.example` |
| Dependency audit in CI (`npm audit --omit=dev --audit-level=high`) | `.github/workflows/ci.yml` |

Note: `style-src 'unsafe-inline'` is required for theme CSS variables and the font registry. No user input reaches CSS except validated `#rrggbb` colors.

Phase 2 (server, accounts, uploads with antivirus scanning, RBAC / tenant isolation) will extend this document.
