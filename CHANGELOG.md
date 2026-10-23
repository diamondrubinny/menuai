# Changelog

All notable changes to MenuAI. Versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor = features).

## [0.2.0] — 2026-10-23

The optional self-hosted server is complete: cloud saving, one-click publishing, scanned image uploads, team management, and production operations.

### Added
- **Cloud sync:** the editor saves menus to your server and autosaves every edit, so you can work from any device. Optimistic locking (`If-Match` → 409) means two devices never overwrite each other silently; you choose which version to keep. ([docs/PHASE2C.md](docs/PHASE2C.md))
- **One-click publishing:**
  - The server renders the menu and serves it at a permanent address (`/m/<name>`). The address is fixed, so printed QR codes stay valid, and the QR is prefilled.
  - Every publish is kept as a version (last 50); owners can restore a version or take the menu offline.
  - Published pages carry a strict CSP, set no cookies and are not logged.
  - Details: [docs/PHASE2D.md](docs/PHASE2D.md).
- **Image uploads:**
  - Each upload is checked by magic bytes, quarantined, scanned by a local ClamAV, then re-encoded to WebP with all metadata (GPS included) removed.
  - There is a storage quota and a daily cleanup of unused images.
  - "Move images to the server" converts images already embedded in a menu.
  - Details: [docs/PHASE2E.md](docs/PHASE2E.md).
- **Team screen** (`#/team`): owners invite people, change roles, disable or re-enable accounts, and resend invitations. ([docs/TEAM_UI.md](docs/TEAM_UI.md))
- **Operations** ([docs/PHASE2F.md](docs/PHASE2F.md)):
  - `scripts/deploy-server.sh`: one-command install/update on Ubuntu. Docker, nginx, Let's Encrypt + HSTS, privacy-friendly logs, first owner.
  - `scripts/backup.sh` / `scripts/restore.sh`: daily backups encrypted with age to a public key, so the server cannot decrypt them. Restore is verified before it touches any data.
  - Automatic data retention: sign-in links, expired sessions, audit log after 12 months, unused images.
  - `cli.mjs status` for monitoring.
- CI: real-stack upload (ClamAV + sharp) and backup → restore round trip, shellcheck, CycloneDX SBOM.
- Docs: production checklist for the server version, retention policy draft, updated cookie policy and terms drafts.

### Changed
- Hebrew wording:
  - "ראשונות" for starters and "סרטנים" for crustaceans;
  - role names בעלים / עורך / צופה;
  - dates read "ב־…".
- The privacy page now describes what the optional server stores.
- The server bundle is built with `scripts/build-server.mjs` (esbuild). `npm run server:dev` rebuilds and restarts on change.

### Security
- Published menus are rendered on the server from validated data; no client-supplied HTML is accepted.
- Unscanned uploads are refused in production, and uploads are disabled when no virus scanner is configured.

## [0.1.0] — 2026-10-22

First public version.

- **Editor:**
  - menus in any language with full RTL;
  - 16 designer themes with light/dark versions, 14 effects, layouts, cover styles, patterns, font pairings;
  - phone/tablet/desktop/TV previews;
  - undo/redo, autosave in the browser.
- **Output:** self-contained HTML export with fonts and images inlined, strict CSP, and no external requests. Also print/PDF, QR codes, and JSON backup.
- **Server foundations:** Fastify API, PostgreSQL migrations, hardened headers, rate limiting, safe logging, Docker Compose. Passwordless magic-link sign-in, owner/editor/viewer roles, CLI.
- **Accessibility:** WCAG 2.1 AA target, checked with axe in CI.
- **License:** AGPL-3.0-only with attribution terms. The "Powered by MenuAI · Open source" credit is kept everywhere.
