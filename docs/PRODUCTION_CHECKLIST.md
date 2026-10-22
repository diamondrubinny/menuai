# Production checklist (Phase 1 — static editor + exported menus)

סמנו כל סעיף לפני פריסה. ✅ = מכוסה אוטומטית ב־CI · 🧑 = דורש בדיקה ידנית · ⚖️ = דורש איש מקצוע.

## Functional
- ✅ Unit tests (`npm test`) — schema, export, store, i18n, storage, theme contrast
- ✅ E2E (`npm run test:e2e`) — edit → preview → autosave → reload, undo, export + language switch, view page, 404
- 🧑 Manual: create a menu from empty, 2+ languages incl. RTL, upload images, export, open the file on a real phone, print to PDF, scan the QR

## Security
- ✅ Input validation (zod) for import & storage; XSS tests on export
- ✅ Exported CSP with script hash; no external requests in export (tested)
- ✅ Image upload: type sniffing, size limit, re-encode
- 🧑 Host headers active (check with securityheaders.com): HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy
- ✅ `npm audit --omit=dev` clean; 🧑 consider SBOM (`npx @cyclonedx/cyclonedx-npm`)
- ✅ No secrets / env vars
- N/A Auth, sessions, RBAC, server-side uploads, antivirus — Phase 2 (uploads never leave the browser in Phase 1)
- N/A Backups — data lives in the user's browser; users are prompted to export JSON backups

## Personal data
| Data | Purpose | Legal basis | Storage | Retention | Third parties |
|---|---|---|---|---|---|
| Menu content & uploaded images | Building the menu | User's own action (no processing by us) | User's browser localStorage | Until the user clears it | None |
| UI language preference | Functionality | Strictly necessary | localStorage | Until cleared | None |

No cookies, trackers or analytics → cookie inventory is empty; no consent banner required **while this remains true**. ⚖️ Re-assess before adding any analytics/marketing tool.

## Documents (drafts — ⚖️ legal review required)
- Privacy policy: in-app `#/privacy`
- Cookie policy: [`docs/legal/cookies.md`](legal/cookies.md)
- Terms of use: [`docs/legal/terms.md`](legal/terms.md)
- Accessibility statement: in-app `#/accessibility` (add coordinator contact details)

## Accessibility
- ✅ axe (WCAG 2.1 A/AA) on all editor tabs (desktop + mobile), all 12 themes, exported file
- 🧑 Keyboard-only walkthrough; NVDA + Firefox, VoiceOver iOS, TalkBack; 200% zoom; RTL; forced colors / high contrast
- ⚖️ Accessibility consultant review for IS 5568 sign-off

## Mobile / performance / SEO
- 🧑 Lighthouse on the editor and an exported menu (target ≥ 90 in all categories)
- 🧑 Real devices: iPhone Safari, Android Chrome, iPad, a TV browser / kiosk
- ✅ Exported menus include title, description, Open Graph, theme-color

## Requires professional sign-off
- ⚖️ Lawyer / privacy officer: privacy policy, terms, Israeli Privacy Protection Law (Amendment 13), GDPR if offered in the EU
- ⚖️ Allergen and price-display rules per country (food regulations)
- ⚖️ Accessibility consultant (IS 5568)
- ⚖️ Penetration test before Phase 2 (server)
