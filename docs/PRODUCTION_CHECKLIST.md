# Production checklist — MenuAI with the server (Phase 2)

סמנו כל סעיף לפני עלייה לאוויר. ✅ = נבדק אוטומטית ב־CI · 🧑 = בדיקה ידנית · ⚖️ = דורש איש מקצוע.
Phase 1 (editor only, no server) is a subset: skip the server sections.

## 1. Functional
- ✅ Unit tests (`npm test`): schema, export, store, i18n, cloud sync engine, media helpers, theme contrast.
- ✅ Server tests (`npm run test:server`):
  - auth, roles, menus, optimistic locking, publishing, uploads, retention, status;
  - against PGlite, and against real PostgreSQL in CI.
- ✅ E2E (`npm run test:e2e`):
  - edit, preview, autosave, export, language switch, view, 404;
  - local mode without a server, with axe.
- ✅ Docker stack in CI:
  - real ClamAV + sharp upload;
  - encrypted backup → data loss → restore.
- 🧑 Two devices editing the same menu:
  - automatic load of the newer version;
  - conflict → "keep mine" / "load cloud version".
- 🧑 Publish → scan the QR on a phone → republish → the same address shows the update → restore an old version → unpublish (guest sees "not found").

## 2. Roles and permissions (server-side, every endpoint)
- ✅ Owner / editor / viewer matrix covered by tests: menus, publish, restore, unpublish, delete, users, uploads.
- ✅ Isolation and request checks:
  - restoring a version of another menu returns 404 (no IDOR);
  - malformed ids return 404;
  - CSRF: requests from another origin are refused (403).
- 🧑 Business continuity:
  - at least two owners;
  - the last active owner cannot be demoted or disabled (enforced; check the procedure is known).

## 3. Sign-in and sessions
- ✅ Magic links:
  - single use, 15 minutes (invites 24 hours);
  - stored as SHA-256 hashes;
  - uniform reply whether or not the address exists;
  - rate limited.
- ✅ Session cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api`, 30 days. Sign-out revokes it; disabling a user revokes all of that user's sessions.
- 🧑 SMTP provider configured (`SMTP_URL`), SPF/DKIM/DMARC for the sender domain, and a test email received.
- ⚖️ Consider MFA for owners if the menu system becomes business critical.

## 4. Input, API and uploads
- ✅ zod validation on every body. The server stores only the validated menu; unknown fields are dropped.
- ✅ Body limits (1 MB API / 12 MB menus / 8 MB images). Rate limits: global, sign-in, publish, uploads, public pages.
- ✅ Published pages:
  - rendered by the server from validated data;
  - strict CSP with script hash; `default-src 'none'` (no API calls from published pages);
  - no cookies.
- ✅ Uploads:
  - magic bytes must match the declared type;
  - SVG/HTML refused;
  - quarantine, then ClamAV, then sharp re-encode (metadata/GPS dropped, pixel-bomb limit);
  - public only after a clean scan;
  - unscanned uploads are refused in production.
- ✅ Path traversal tests on `/m/` and `/media/`.
- 🧑 ClamAV signatures updating: `docker compose logs clamav | grep -i "database updated"`.
- 🧑 Headers check (e.g. securityheaders.com) on the editor, a published menu and an image.
- ⚖️ **Penetration test** before opening to the public or to several businesses.

## 5. Secrets and configuration
- ✅ No secrets in the repository. `.env` is created by the deploy script with a random DB password, mode 600, and never overwritten.
- ✅ Config validated at start-up:
  - production requires `https://`;
  - `UPLOADS_ALLOW_UNSCANNED` is refused;
  - blank values are treated as unset.
- ✅ Logs:
  - redacted (cookies, auth headers, query strings);
  - guest visits to `/m/` and `/media/` not logged by the API;
  - nginx access log with truncated IPs and no query strings.
- 🧑 `.env` and backup keys are not on shared machines. The **age private key is not on the server**.

## 6. Dependencies and supply chain
- ✅ `npm audit --omit=dev --audit-level=high` in CI.
- ✅ CycloneDX SBOM artifact on every CI run.
- ✅ shellcheck on all scripts.
- ✅ The runtime image contains the bundle plus `sharp` only, runs as non-root, with a read-only filesystem, and has no published database/ClamAV ports.
- 🧑 Update regularly: re-run `scripts/deploy-server.sh` (pulls, rebuilds, keeps data); `apt upgrade` on the host.

## 7. Backups and restore
- ✅ `scripts/backup.sh`:
  - database + released images + published menus;
  - encrypted with age to a public key;
  - written atomically, mode 600, keeps 14 days.
- ✅ `scripts/restore.sh`:
  - verifies decryption and checksums **before** touching data;
  - requires `--yes`;
  - stops the API and checks health afterwards.
- ✅ Round trip tested in CI (real Docker stack).
- 🧑 Daily timer active: `systemctl list-timers menuai-backup.timer`. Copy backups **off the server** (rsync / object storage).
- 🧑 **Restore drill** on a spare machine at least once per quarter.

## 8. Personal data (Israel PPL incl. Amendment 13 / GDPR) — ⚖️ review
| Data | Purpose | Legal basis | Storage | Retention | Third parties |
|---|---|---|---|---|---|
| Team email, name, role | Accounts, sign-in, permissions | Contract | PostgreSQL on the business's own server | While the account exists; ⚖️ define deletion of disabled accounts | Email provider (delivery only) — **DPA** |
| Sign-in link hashes | Security | Contract | PostgreSQL | 24 hours (enforced daily) | — |
| Session hashes, user agent | Security | Legitimate interest | PostgreSQL | Until expiry, max 30 days (enforced) | — |
| Audit log (no menu content) | Security, accountability | Legitimate interest | PostgreSQL | 12 months (enforced) | — |
| Menu content and images | The service | Contract | PostgreSQL + disk | Until deleted; unused images 24 hours; 50 published versions per menu | — |
| Rejected upload records (no file) | Security | Legitimate interest | PostgreSQL | 12 months (enforced) | — |
| Pay at the table: bills, payments (amounts, tip, status, provider ref) | Payment, accounting | Contract, legal obligation | PostgreSQL | ⚖️ per tax law (typically 7 years) | Payment provider holds the transaction — **DPA** |
| Payer name + mobile (Grow only) | Provider's receipt | Contract | **Not stored**; passed to the provider | — | Payment provider — **DPA** |
| Guests of published menus | — | — | Nothing stored by MenuAI. nginx log: truncated IP, path, status, 14 days (logrotate) | 14 days | — |
| Backups | Recovery | Legitimate interest | Encrypted (age) on the server + your off-site copy | 14 days on the server; ⚖️ define off-site retention | Storage provider, if any — encrypted, **DPA** |

Retention policy: [`docs/legal/retention.md`](legal/retention.md).

## 9. Cookies and trackers
| Name | Where | Type | Purpose | Retention | Consent |
|---|---|---|---|---|---|
| `menuai_session` | Editor (team only), `Path=/api` | First-party HttpOnly cookie | Keep a team member signed in | 30 days / sign-out | Not required: strictly necessary |
| `menuai:menu:v1`, `menuai:prefs:v1`, `menuai:cloud:v1` | Editor | localStorage | Draft, interface language, cloud link | Until cleared | Not required: functional, user-initiated |
| — | Published menus | — | **Nothing** stored on guests' devices | — | — |

No analytics, pixels or marketing tools, so no consent banner is needed **while this remains true**. ⚖️ Re-assess before adding any.

## 10. Documents (drafts — ⚖️ legal review required before publishing)
- Privacy policy: in-app `#/privacy` (covers the optional server).
- Cookie policy: [`docs/legal/cookies.md`](legal/cookies.md).
- Terms of use: [`docs/legal/terms.md`](legal/terms.md).
- Retention and deletion policy: [`docs/legal/retention.md`](legal/retention.md).
- Accessibility statement: in-app `#/accessibility`. Add the accessibility coordinator's details.

## 11. Accessibility
- ✅ axe (WCAG 2.1 A/AA):
  - all editor tabs (desktop + mobile), all themes and their light/dark versions;
  - exported file;
  - cloud section (he/en, light/dark).
- 🧑 Keyboard-only walkthrough including cloud, publish, version history and conflict banner.
- 🧑 NVDA + Firefox, VoiceOver iOS, TalkBack; 200% zoom; RTL; forced colors.
- ⚖️ Accessibility consultant sign-off (IS 5568).

## 12. Mobile, performance, SEO
- 🧑 Lighthouse on the editor and a published menu (target ≥ 90).
- 🧑 Real devices: iPhone Safari, Android Chrome, iPad, a TV / kiosk browser.
- ✅ Published menus:
  - title, description, Open Graph, theme-color;
  - images served as WebP with year-long immutable caching;
  - pages revalidated with ETag.

## 13. Operations
- 🧑 `docker compose exec api node dist-server/cli.mjs status` returns `OK` for everything. Hook `/api/health` to an uptime monitor.
- 🧑 Disk space alerts, using the free-space line in `status`. ClamAV needs about 1.5 GB of RAM; the full stack about 2.5 GB.
- 🧑 Know where the security events are: `audit_log` table (sign-ins, invites, role changes, publish/unpublish/restore/delete, infected uploads, CLI actions).

## 14. Pay at the table ([docs/PAYMENTS.md](PAYMENTS.md))
- 🧑 `PAYMENTS_KEY` is set (32 random bytes) and a copy is in a password manager. Backups do not include `.env`.
- 🧑 `PAYMENTS_ALLOW_FAKE` is **not** set (the config refuses it in production anyway).
- 🧑 The whole flow passes in **test mode** on real phones (iOS Safari, Android Chrome) and on the table tablet:
  - pay in full;
  - split equally;
  - a custom amount;
  - a tip;
  - decline;
  - two guests paying at once.
- 🧑 The Grow sandbox run in [docs/PAYMENTS.md](PAYMENTS.md#grow-sandbox-run-before-going-live) passed: paid, split, tip, cancel, and two guests at once.
- 🧑 A payment-terms link is set in Settings, so guests must accept the terms (Grow's review requires it).
- 🧑 Before going **live** with Grow:
  - Grow's production review is done (server updates answered with HTTP 200, `approveTransaction` sent);
  - `PAYMENTS_GROW_LIVE=true` is set;
  - production identifiers are entered in Settings, not in files.
- 🧑 Printed table QR codes open `/t/…` (nginx forwards `/t/` and `/pay/` to the API). If a printed code leaks, use **Replace QR code**.
- 🧑 Waiters (editors) can open, adjust and close bills. Only owners can change settings and tables (try it with an editor account).
- 🧑 The nginx log shows `/t/[table]`, never the table code.
- ⚖️ Receipts and tax invoices: who issues them, and the allocation-number rules. An accountant must confirm.
- ⚖️ Payment terms, the cancellation/refund policy and the privacy policy payments section, checked by a lawyer. A DPA with the payment provider.
- 🌐 An Arabic native speaker reviews the guest pages.
- 🔍 A penetration test covers `/t/`, `/pay/` and `/api/payments/notify/`.

## Requires professional sign-off
- ⚖️ Lawyer / privacy officer:
  - privacy policy, terms, retention policy;
  - Israeli Privacy Protection Law (Amendment 13): database registration/definition and security procedures;
  - GDPR if offered in the EU;
  - DPAs with the email and backup-storage providers.
- ⚖️ Allergen and price-display rules per country (food regulations).
- ⚖️ Accessibility consultant (IS 5568).
- ⚖️ Penetration test of the server.
