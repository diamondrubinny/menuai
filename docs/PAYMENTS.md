# Pay at the table

> Status: **Phase 3b**: **Grow (Meshulam)** is implemented and tested against a simulated Grow API that follows Grow's documented contract. **Live mode stays locked** (`PAYMENTS_GROW_LIVE`) until the whole flow has passed in Grow's own sandbox ([below](#grow-sandbox-run-before-going-live)). The built-in demo provider remains for development.
> **Phase 3b**: Grow (Meshulam), tested end to end against Grow's sandbox. Plan and decisions: [PAYMENTS_PLAN.md](PAYMENTS_PLAN.md).

Guests pay the bill from the table:
- They scan the table's QR code with their phone, or use the tablet on the table.
- They choose to pay everything, split equally, or pay a custom amount. They can add a tip.
- They pay on the payment company's own secure page.

MenuAI never sees, receives or stores card details.

## How it works

```
Waiter (editor)                  Guest (phone / table tablet)                Payment company
───────────────                  ────────────────────────────                ───────────────
Opens a bill: table 7, ₪284.50
                                 /t/<table code> → bill, split, tip
                                 "Pay securely" ─── server reserves the share,
                                                    asks the provider for a payment page ──▶ hosted page
                                                                                             (card / Bit / wallets)
                                 ◀── back to /t/<code>/done/<id>              server notification ──▶ /api/payments/notify/<provider>
                                     server asks the provider for the status (server-to-server)
Sees "Paid ₪142.25 + tip ₪17.07"; the bill closes itself when fully paid
```

### Trust rules (enforced in code)

| Rule | Where |
|---|---|
| A payment counts as paid only after the server confirms it **with the provider**, for the **exact amount** requested. The browser's return and the provider's notification are only hints. | `payments/service.ts` `verifyPayment` |
| Amounts are integer agorot. The guest only *chooses* (whole / split / amount, tip). The server computes everything against the bill under a row lock. | `payments/money.ts`, `startCheckout` |
| A checkout reserves its share, so two guests can't both pay the whole bill. Declined checkouts release it at once. A checkout left open for more than 20 minutes is released only after checking with the provider. If money still arrives after the bill was paid, closed or cancelled, it is recorded and **flagged to staff for a refund or review**, never accepted silently. A bill can't be cancelled while a guest is paying it. | `RESERVATION_MINUTES`, `releaseStaleCheckouts`, `review_reason` |
| A notification must match a per-payment secret (demo) or the provider's process token (Grow). Otherwise it is ignored and logged. | `handleNotification` |
| A table's QR holds a random 128-bit code, not a table number. A payment page is visible only through its own table's code. Replacing a QR invalidates the old one. | `dining_tables.token`, `/t/:token/done/:id` |
| Provider credentials are encrypted with AES-256-GCM under `PAYMENTS_KEY` (from the environment, not the database), and the API never returns them. | `payments/crypto.ts` |
| Guest pages are server-rendered with every value escaped. They have a strict CSP: one script allowed by hash, and forms only to us and the provider. They set no cookies, use `no-store`, and are not logged (the nginx log replaces the table code with `[table]`). | `payments/pages.ts`, `scripts/deploy-server.sh` |
| Staff endpoints check the role on the server for every request:<br>- **Owner:** settings and tables.<br>- **Editor:** bills.<br>- **Viewer:** none. | `payments/routes.ts` |

## Setup

1. **Key.**
   - `scripts/deploy-server.sh` adds `PAYMENTS_KEY` to `.env`, both on a new install and when updating an existing one.
   - To add it by hand: `PAYMENTS_KEY=$(openssl rand -base64 32)`.
   - **Keep a copy in your password manager.** Backups do not include `.env`. Without the key, the owner re-enters the provider details after a restore.
2. **Provider.** In the editor: Cloud → 💳 Pay at the table → Settings (owner).
   - Choose the payment company.
   - Enter the account details it gave you.
   - Turn it on, in test mode first.
3. **Tables.** Add tables and link each one to its menu.
   - Download each QR (SVG) and print it for the table.
   - Or open the table's link on the table tablet.
4. **Bills.** A waiter (editor) opens a bill with the amount from the till. Guests can pay right away.
   - **Paid another way** closes a bill paid in cash or at the counter.
   - **Cancel** is only for a bill opened by mistake, with nothing paid on it.

### Demo provider (development only)

Set `PAYMENTS_ALLOW_FAKE=true` (it is refused in production). The provider "Demo (no real money)" shows a page with **Approve** and **Decline**, and follows the same server-side rules as a real provider.

## Providers

| Provider | Status | Notes (*verify with the provider*) |
|---|---|---|
| Demo | ✅ 3a | Development and tests only |
| Grow (Meshulam) | ✅ 3b (sandbox run pending) | Server-side `createPaymentProcess` → hosted page; server update → `getPaymentProcessInfo` check → `approveTransaction` (required for every successful transaction). The page needs the payer's full name and Israeli mobile number, which are passed through and not stored. Sandbox: `https://sandbox.meshulam.co.il/api/light/server/1.0/`. Production identifiers are issued after Grow reviews the integration. |
| PayPlus, Cardcom, Tranzila | Later | Same adapter interface (`payments/providers/types.ts`) |

Adding a provider means implementing `PaymentProvider`: `createSession`, `parseNotification`, `matches`, `fetchStatus` and optionally `acknowledge`. Register it in `providers/index.ts` and list its credential fields in `routes.ts`. Then add tests with a mocked provider API.

## Data (data map additions)

| Data | Purpose | Legal basis (⚖️ confirm) | Stored | Retention | Third parties |
|---|---|---|---|---|---|
| Tables (name, code, linked menu) | Showing the right bill | Contract / legitimate interest | DB | Until deleted | — |
| Bills (amount, staff note, who opened them, times) | Collecting payment, accounting | Contract, legal obligation (accounting) | DB | ⚖️ As tax law requires (typically 7 years); not deleted automatically | — |
| Payments (share, tip, status, provider reference, times) | Reconciliation, refunds | Contract, legal obligation | DB | As bills | Provider holds the transaction |
| Abandoned checkouts | Releasing reservations | Legitimate interest | DB | Marked expired after 24 h | — |
| Provider notification log (no names, phones or card data) | Troubleshooting, audit | Legitimate interest | DB | 13 months | — |
| Payer name and mobile (Grow only) | Provider requirement (receipt) | Contract | **Not stored by MenuAI**; sent to the provider | — | Provider (DPA ⚖️) |
| Card / Bit details | Payment | — | **Never reach MenuAI** | — | Provider only |

## Changing settings safely

- **Turning payments off** stops new checkouts. Guests who are already on the payment page are still recorded when they finish, because their notification is verified with the configured provider.
- **Changing the provider, the mode (test/live) or the account details** is refused (`payments_in_progress`) while any guest is in the middle of paying. A checkout is verified with what it started with, so switching underneath it could leave a real charge unconfirmed. Wait a moment, or let abandoned checkouts be released (20 minutes, checked with the provider), then change.
- **Tips, terms link and on/off** can change at any time.

## The table tablet: menu ↔ payment

The table's QR code, or the address opened on the table tablet, leads to `/t/<code>`. From there, **📖 View menu** opens the published menu in the guest's language, as `/m/<menu>?lang=…#table=<code>`.

On that menu a fixed **💳 Pay the bill** button leads back to the table page. This matters in kiosk mode, where there is no Back button. The button:

- is in the guest's current menu language and the theme's colors;
- reads the code from the URL fragment, which browsers never send to a server, so it never reaches a log;
- keeps the code for that browser tab only (`sessionStorage`) and removes it from the visible address, so a shared link does not carry it;
- appears only on menus served from a MenuAI server (`/m/…`), never in a downloaded HTML file;
- leaves room at the bottom so the menu's credit line stays visible;
- is hidden when printing.

## Report, export and flagged payments (owner)

- **Report** (Pay at the table → Report):
  - Shows, per business day (`BUSINESS_TIMEZONE`, default `Asia/Jerusalem`), the bills, payments, money collected and tips paid through the app. Real and test payments are shown separately.
  - Cash and card payments at the till are not included.
  - The range is up to 92 days.
- **CSV export:**
  - One row per payment: time, table, amount, tip, total, provider, mode, reference and review state.
  - It is written for Excel: UTF-8 with a BOM, and cells that could start a formula get a `'` prefix (CSV injection).
  - It contains no payer details, because MenuAI has none. Each export is recorded in the audit log.
- **Flagged payments:**
  - A payment that arrived after the bill was paid, closed or cancelled shows ⚠️ until the owner refunds it in the provider's dashboard and clicks **Mark as handled**, with a short note.
  - The note and who handled it are kept, and the action is audited.
  - Refunds through the provider's API come later (Phase 3d), once the provider's refund call is documented and tested.

## Grow: how it works here

| Step | MenuAI does | Source |
|---|---|---|
| Checkout | `createPaymentProcess` from the server with `userId`, `pageCode`, `sum` (decimal), `successUrl`, `cancelUrl`, `notifyUrl`, `description` (letters, digits and spaces only), `pageField[fullName]`, `pageField[phone]`, `cField1` = our payment id. It redirects the guest only to an `https` page on `*.meshulam.co.il`, `*.grow.link` or `*.grow.business`. | Grow docs: Regular Payment |
| Server update | Accepted at `/api/payments/notify/grow` as form fields (`data[...]`, multipart or urlencoded, max 32 KB). It must carry the `processId` + `processToken` we stored (compared in constant time). Otherwise it is ignored. | Grow docs: Server Response |
| Confirmation | `getPaymentProcessInfo` (server → Grow). The payment counts only with `statusCode` 2 and `sum` equal to the requested amount. Anything else, including an unknown response layout, stays pending. | Grow docs (response layout not published: parsed conservatively) |
| Acknowledgement | `approveTransaction` with the fields from the update. If it fails, the payment stays recorded and Grow resends the update (at 10, 20 and 30 minutes). | Grow docs: Approve Transaction |
| Grow unreachable | The notification gets `503` and Grow retries. The guest's result page says "confirming…". | |
| Payer name and phone | Passed to Grow and **never stored** by MenuAI (a test checks the database). | |
| Terms | If the owner sets a payment-terms link, guests must tick "I accept the payment terms" (enforced on the server). Grow's production review requires this. | Grow docs: Transition to Production |

## Grow sandbox run (before going live)

Grow sends server updates only to a public HTTPS address (not localhost), so run this on the real server in **test** mode:

1. Ask Grow (`apisupport@grow.business`) for **sandbox** `userId` and `pageCode`, and for server updates to be enabled. Never put them in files or chat: enter them only in **Settings**.
2. Settings: provider **Grow**, mode **Test**, enter the identifiers and the payment-terms link, then turn it on.
3. Open a bill and pay from a phone with Grow's sandbox test card `4580458045804580`. Check that:
   - the staff screen shows **Paid**, with the reference number;
   - the bill closes when it is fully paid;
   - the transaction appears as approved in Grow's sandbox dashboard.
4. Also check:
   - a split between two phones;
   - a tip;
   - cancelling on Grow's page (you return to the table page and nothing is charged);
   - two phones paying the whole bill at once (the second is refused).
5. Bit, Apple Pay and Google Pay have no sandbox at Grow and charge real money. Test them in live mode with small amounts.
6. If anything does not match, export `payment_events` for the time of the test (it holds no personal data), and keep the request ids from the server log.
7. Request Grow's production review. Then:
   - set `PAYMENTS_GROW_LIVE=true` in `.env` and restart;
   - enter the **production** identifiers;
   - switch the mode to **Live**.

## Before going live (see also [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) §14)

- ⚖️ Receipts and tax invoices: who issues them (the provider's invoice module or your accounting system)? The Israel Tax Authority allocation-number rules for invoices above the threshold apply (*verify the current threshold*). An accountant must confirm this.
- ⚖️ Terms of payment and cancellation/refund policy shown to guests; privacy policy payments section; DPA with the provider.
- The whole flow passes in test mode on real phones (iOS Safari, Android Chrome) and on the table tablet.
- An Arabic native speaker has reviewed the guest pages.
- A penetration test covers `/t/`, `/pay/` and `/api/payments/notify/`.
