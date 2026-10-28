# Pay at the table

> Status: **Phase 3a** (this release): the full flow with the built-in **demo provider** (no real money).
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
| A checkout reserves its share for 20 minutes, so two guests can't both pay the whole bill. Declined or failed checkouts release it at once. | `RESERVATION_MINUTES` |
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
| Grow (Meshulam) | 3b | Server-side `createPaymentProcess` → hosted page; server update → `getPaymentProcessInfo` check → `approveTransaction` (required for every successful transaction). The page needs the payer's full name and Israeli mobile number, which are passed through and not stored. Sandbox: `https://sandbox.meshulam.co.il/api/light/server/1.0/`. Production identifiers are issued after Grow reviews the integration. |
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

## Before going live (see also [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) §14)

- ⚖️ Receipts and tax invoices: who issues them (the provider's invoice module or your accounting system)? The Israel Tax Authority allocation-number rules for invoices above the threshold apply (*verify the current threshold*). An accountant must confirm this.
- ⚖️ Terms of payment and cancellation/refund policy shown to guests; privacy policy payments section; DPA with the provider.
- The whole flow passes in test mode on real phones (iOS Safari, Android Chrome) and on the table tablet.
- An Arabic native speaker has reviewed the guest pages.
- A penetration test covers `/t/`, `/pay/` and `/api/payments/notify/`.
