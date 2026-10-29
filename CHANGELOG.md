# Changelog

All notable changes to MenuAI. Versions follow [Semantic Versioning](https://semver.org/) (pre-1.0: minor = features).

## [Unreleased]

### Added
- **Refunds from the bills screen** (owner, Phase 3d; [docs/PAYMENTS.md](docs/PAYMENTS.md#refunds-owner)):
  - Full or partial refunds through Grow (`refundTransaction`) and PayPlus (`Transactions/RefundByTransactionUID`), never more than was charged.
  - One refund at a time per payment, enforced by a row lock and a database index. A refund whose outcome is unknown (connection lost) is never retried automatically: the owner checks the provider's dashboard and confirms it.
  - Grow's rules are checked before calling: only the whole amount on the day of the payment, and at most 2 refunds.
  - The report and CSV show refunded amounts. A flagged payment refunded in full is marked handled. Every step is audited.
- **Pay at the table, Phase 3b: Grow (Meshulam)** ([docs/PAYMENTS.md](docs/PAYMENTS.md)):
  - **Checkout:** `createPaymentProcess` sends the guest to Grow's hosted page (card, Bit, wallets).
  - **Server updates:** accepted as form fields. They must carry the stored process token, and are confirmed with `getPaymentProcessInfo` (statusCode 2, exact amount) before the payment counts. `approveTransaction` then follows.
  - **Privacy:** the payer's name and phone go to Grow only and are never stored.
  - **Live mode stays locked** until the sandbox run has passed (`PAYMENTS_LIVE_PROVIDERS`).
- **After an update, published menus are re-rendered automatically** when the server starts, from their live version. This only applies to menus whose page still carries an older runtime script, which the current CSP would block. Without it, language switching and the menu's interactions would stop on menus published before the update.
- **Table tablet:**
  - The table page opens the menu in the guest's language. The menu then shows a fixed **💳 Pay the bill** button back to the table page, which works in kiosk mode without a Back button.
  - The table code travels in the URL fragment, which never reaches a server or a log. It is kept for that browser tab only and removed from the visible address.
- **Payment report** (owner):
  - Bills, payments, money collected and tips per business day (`BUSINESS_TIMEZONE`, default Asia/Jerusalem).
  - CSV export for accounting and sharing tips. It opens in Excel with Hebrew, cells that would start a formula are neutralized, and each export is audited.
- **Flagged payments** (late or over-payments) can be marked as handled with a note, after the refund was made in the provider's dashboard. This is audited.
- **Pay at the table, Phase 3c: PayPlus** ([docs/PAYMENTS.md](docs/PAYMENTS.md)):
  - **Hosted page:** created with `PaymentPages/generateLink`, and it expires together with the reservation.
  - **Signed callbacks:** callbacks carry an HMAC-SHA256 signature made with the secret key and are trusted only when it is verified on the exact raw body.
  - **IPN fallback:** used when the guest returns first.
  - **Privacy:** PayPlus's card, ID and customer fields are never read.
- **Live mode is enabled per provider** with `PAYMENTS_LIVE_PROVIDERS` (e.g. `grow,payplus`), and only after each provider's sandbox run.
- **Payment terms:** owners can set a link to their payment terms; guests must accept them before paying. Grow's production review requires this.
- **Pay at the table, Phase 3a** ([docs/PAYMENTS.md](docs/PAYMENTS.md), plan in [docs/PAYMENTS_PLAN.md](docs/PAYMENTS_PLAN.md)):
  - **Guests:** they scan a table's QR code or use the table tablet. They pay the whole bill, split it equally, or pay any amount, and can add a tip, then pay on the provider's hosted page. The pages are in Hebrew, English and Arabic, work without JavaScript, and target WCAG 2.1 AA.
  - **Staff screen** (`#/payments`):
    - Waiters (editors) open, adjust and close bills, and see payments arrive.
    - Owners manage tables, with a QR per table, replacing a leaked code, and linking each table to a menu.
    - Owners set the provider, test/live mode and tip options.
  - **Security:**
    - A payment counts only after a server-to-server check with the provider, for the exact amount.
    - Shares are reserved under a row lock, so two guests can't both pay the whole bill.
    - Table codes are random, and provider credentials are encrypted with `PAYMENTS_KEY`.
    - Guest pages use a strict CSP and are never logged.
  - **Providers:** a built-in demo provider (development only, refused in production). Grow (Meshulam) follows in Phase 3b.
- `scripts/deploy-server.sh` adds `PAYMENTS_KEY` to `.env` and forwards `/t/` and `/pay/` to the API. The nginx privacy log replaces table codes with `[table]`.
- `package.json`: author, repository and homepage.

### Fixed (review of the Grow, report and tablet changes)
- **Payments in progress are no longer lost when settings change.**
  - A payment that completes after payments were switched off is still verified and recorded.
  - Changing the provider, mode or account details is refused while a guest is paying.
- **Terms links** like `HTTPS://…` or `https:example.com` get a clear 400 instead of a server error.

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

### Fixed (pre-release review)
- Sync:
  - Undoing back to the version loaded from the server is now synced. Before, publishing could include an edit the user had undone.
  - A loaded server version is saved locally before its version number is recorded, so a reload in between can no longer overwrite the server with an older menu.
  - A late save response can no longer roll back the version after a restore.
  - A viewer's local edits no longer block team updates.
- Publishing: deleting a menu while it is being published no longer leaves its page online. Files are now removed after the database commits.
- Uploads:
  - Uploads interrupted by a crash are cleaned up within an hour.
  - The unused-image cleanup reads each menu once instead of once per image, so it no longer risks the statement timeout.
- Install script: a failed type check or nginx test now stops the install instead of deploying a stale editor.

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
