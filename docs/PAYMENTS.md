# Pay at the table

> Status: **Phase 3b**: **Grow (Meshulam)** is implemented and tested against a simulated Grow API that follows Grow's documented contract. **Live mode stays locked** (`PAYMENTS_LIVE_PROVIDERS`) until the whole flow has passed in Grow's own sandbox ([below](#grow-sandbox-run-before-going-live)). The built-in demo provider remains for development.
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
| PayPlus | ✅ 3c (sandbox run pending) | `PaymentPages/generateLink` → hosted page (expires with the reservation). **Signed callbacks** (HMAC-SHA256 with the secret key) are trusted once verified. Otherwise `PaymentPages/ipn` is used, parsed conservatively. Staging: `https://restapidev.payplus.co.il/api/v1.0/`. |
| Cardcom, Tranzila | Later | Same adapter interface (`payments/providers/types.ts`) |

Adding a provider means implementing `PaymentProvider`: `createSession`, `parseNotification`, `matches`, `fetchStatus` and optionally `acknowledge`. Register it in `providers/index.ts` and list its credential fields in `routes.ts`. Then add tests with a mocked provider API.

## Data (data map additions)

| Data | Purpose | Legal basis (⚖️ confirm) | Stored | Retention | Third parties |
|---|---|---|---|---|---|
| Tables (name, code, linked menu) | Showing the right bill | Contract / legitimate interest | DB | Until deleted | — |
| Bills (amount, staff note, who opened them, times) | Collecting payment, accounting | Contract, legal obligation (accounting) | DB | ⚖️ As tax law requires (typically 7 years); not deleted automatically | — |
| Payments (share, tip, status, provider reference, times) | Reconciliation, refunds | Contract, legal obligation | DB | As bills | Provider holds the transaction |
| Provider handles for refunds (Grow transactionId + transactionToken, PayPlus transaction uid; not card data) | Refunding through the provider's API | Contract | DB, with the payment | As bills | Provider |
| Refunds (amount, status, the provider's refund reference or error code, owner's note, who and when) | Accounting, audit | Contract, legal obligation | DB | As bills | Provider performs the refund |
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
  - A flagged payment that is refunded in full from here (see below) is marked handled automatically.

## Refunds (owner)

On the bills screen, a paid payment has **↩ Refund** for the owner. Enter the amount (it starts at what is left to refund) and an optional reason, then confirm.

- **Limits (server-enforced):**
  - at most what was charged (share + tip), minus refunds that went through;
  - only through the provider and mode the payment was made with. After switching provider or mode, refund in the old provider's dashboard and mark the payment handled;
  - **one refund at a time per payment** (row lock + a unique index), so a double click can't refund twice;
  - Grow's rules: on the day of the payment only the whole amount (it is a cancellation); at most 2 refunds per payment through the API;
  - owner only, rate limited (10 per minute), every step audited (`payment.refund_requested`, `…_succeeded` / `…_failed` / `…_unknown`, `…_confirmed`).
- **Outcomes:**
  - **Refunded:** the provider accepted it. Its reference is shown when it returns one.
  - **Refused:** the provider said no (e.g. not enough balance). Nothing was refunded; only the error code is kept.
  - **Unknown:** the connection failed mid-call, so it may or may not have happened. **It is never retried automatically.** The bill stays in the open list until the owner checks the provider's dashboard and clicks **It was refunded** or **It was not refunded**. No new refund is possible on that payment until then. A refund interrupted by a restart shows up the same way after 2 minutes.
- A refund doesn't reopen the bill: it is an adjustment after payment. If the guest has to pay again, open a new bill.
- The **report** has a **Refunded** column per business day (the day of the refund, which can differ from the day of the payment). The **CSV** has a `refunded` column per payment.
- Refund confirmations from the provider (email to the guest, a credit invoice) follow the provider's own settings. ⚖️ Whether a credit document must be issued is a question for the accountant.

| Provider | Call | Source |
|---|---|---|
| Grow | `refundTransaction` (multipart: `userId`, `transactionId`, `transactionToken`, `refundSum`, `pageCode`). Only Grow's `status: 1` counts as refunded. The response layout is not published, so no refund reference is read. | Grow docs: Refund Transaction, Refund overview |
| PayPlus | `Transactions/RefundByTransactionUID` (JSON: `transaction_uid`, `amount`; `api-key` + `secret-key`). `results.status` success, with the refund's `status_code` 000 when present. | PayPlus docs: Refund by transaction UID |

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

## PayPlus: how it works here

| Step | MenuAI does | Source |
|---|---|---|
| Checkout | `PaymentPages/generateLink` is called from the server with the `api-key` and `secret-key` headers. It sends `payment_page_uid`, `charge_method` 1 (charge), `amount` in shekels, `currency_code` ILS, `language_code` (he/en), `expiry_datetime` 20 minutes (the reservation), the success/failure/cancel/callback URLs, and `more_info` = our payment id. No payer details are sent: PayPlus's page collects what it needs. The guest is redirected only to an `https` page on `*.payplus.co.il`. | PayPlus docs: Generate Payment Link |
| Callback | Accepted at `/api/payments/notify/payplus` as JSON. It is trusted only if `user-agent` is `PayPlus` and the `hash` header equals base64(HMAC-SHA256(secret key, **exact raw body**)), compared in constant time. It must match our `page_request_uid`. `status_code` 000 with the exact amount counts as paid; another code counts as declined. Card, ID and customer fields are never read. | PayPlus docs: Validate Requests, Transaction Callback |
| Return before the callback | `PaymentPages/ipn` with our `payment_request_uid`. The response layout is not published, so only an approved record for *this* page request, with the exact amount, counts. | PayPlus docs: IPN |
| Late payment | The page expires after 20 minutes, which is when a reservation can be released. Any charge that still arrives is recorded and flagged for refund or review. | |

## PayPlus sandbox run (before going live)

1. Get **staging** (dev) credentials from PayPlus: the API key, the secret key and the payment page UID. Set the page's callback to be allowed. Enter them only in **Settings**.
2. Settings: choose **PayPlus**, mode **Test**, add the terms link, and turn it on.
3. Pay a bill with PayPlus's sandbox card **5326-1402-8077-9844** (05/30, CVV 000), and check:
   - the staff screen shows **Paid** with the approval number;
   - the bill closes;
   - PayPlus's dashboard shows the transaction.
4. Try the rejected card **5326-1402-0001-0120**. Nothing is charged, and the guest can try again. Then test a split, a tip, a cancel, and two phones paying at once.
5. Refund part of a test payment, then the rest, from the bills screen. Check that both show as **Refunded** and that PayPlus's dashboard shows them.
6. Add `payplus` to `PAYMENTS_LIVE_PROVIDERS`, restart, enter the **production** credentials and switch to **Live**.

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
5. Refunds: refund a payment made **today** in full (a cancellation). Check that a partial refund of today's payment is refused with a clear message. The next day, refund part of another payment. Check both in Grow's dashboard. If Grow's refund response has a reference field, note it for a follow-up.
6. Bit, Apple Pay and Google Pay have no sandbox at Grow and charge real money. Test them in live mode with small amounts.
7. If anything does not match, export `payment_events` for the time of the test (it holds no personal data), and keep the request ids from the server log.
8. Request Grow's production review. Then:
   - add `grow` to `PAYMENTS_LIVE_PROVIDERS` in `.env` (e.g. `PAYMENTS_LIVE_PROVIDERS=grow`) and restart;
   - enter the **production** identifiers;
   - switch the mode to **Live**.

## Before going live (see also [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) §14)

- ⚖️ Receipts and tax invoices: who issues them (the provider's invoice module or your accounting system)? The Israel Tax Authority allocation-number rules for invoices above the threshold apply (*verify the current threshold*). An accountant must confirm this.
- ⚖️ Terms of payment and cancellation/refund policy shown to guests; privacy policy payments section; DPA with the provider.
- The whole flow passes in test mode on real phones (iOS Safari, Android Chrome) and on the table tablet.
- An Arabic native speaker has reviewed the guest pages.
- A penetration test covers `/t/`, `/pay/` and `/api/payments/notify/`.
