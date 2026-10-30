# MenuAI: Pay from the table (Phase 3 plan, draft for approval)

> Author: Diamond Rubinny · Status: **approved 2026-10-28**: MVP = flow A (pay the bill by table), first provider = Grow (Meshulam).
> All provider details marked *(verify)* need checking against each provider's official documentation before implementation.

## 1. Goal

A guest pays the restaurant directly from the tablet showing the menu, or from their own phone after scanning a QR code. The restaurant chooses its payment provider. MenuAI never sees or stores card numbers.

## 2. Payment flows (MVP: choose one or more, see questions)

| # | Flow | How it works | Complexity |
|---|---|---|---|
| A | **Pay the bill by table** (recommended for MVP) | A waiter opens a bill for a table in the editor (amount, optional items). A per-table QR or the table tablet shows "Pay ₪184". The guest adds a tip, picks split (full / equal parts / custom amount), and pays on the provider's secure page. | Medium |
| B | **Order and pay from the menu** | The guest adds dishes from the menu to a cart and pays; the order appears on a kitchen/staff screen. The price is always recomputed on the server from the published menu. | High (cart, modifiers, order screen, stock, refunds) |
| C | **Pay any amount** | A table QR opens "Enter amount" (for restaurants whose POS holds the bill). | Low |
| D | **POS sync** | Pull the open bill from the POS (Beecomm, Tabit, etc.). | Very high, per POS; only with a partner API *(verify)*. |

**Decided:** MVP = **A**. C and B later, D only on request.

## 3. Providers (adapter per provider)

Every provider is an adapter behind one interface, configured by the owner. Only **hosted payment pages** (redirect, or the provider's own iframe): card data goes directly from the guest to the provider (PCI DSS SAQ A scope *(verify with the provider/QSA)*).

| Provider | Market | Notes *(verify)* |
|---|---|---|
| Grow (Meshulam) | IL | Payment pages, Bit, Apple/Google Pay, invoices; a post-callback approval call is required |
| PayPlus | IL | REST/JSON, iframe/redirect, Bit |
| Cardcom | IL | Strong invoice/receipt integration |
| Tranzila | IL | Hosted iframe, query-string API |
| Hyp (CreditGuard) | IL | Enterprise |
| Stripe Checkout | International | Israeli business onboarding is unclear; verify country support |
| PayPal | International | Optional |

Bit, Apple Pay and Google Pay are offered through the provider's page when the provider supports them. **Decided:** Grow first, through the same interface; others follow.

```ts
interface PaymentProvider {
  id: 'grow' | 'payplus' | 'cardcom' | 'tranzila' | 'stripe' | 'fake';
  createSession(input: { paymentId: string; amountAgorot: number; currency: 'ILS'; description: string;
    successUrl: string; cancelUrl: string; webhookUrl: string; locale: string }): Promise<{ redirectUrl: string; providerRef: string }>;
  verifyWebhook(req: RawRequest): Promise<VerifiedEvent | null>;   // signature/secret check, then
  fetchStatus(providerRef: string): Promise<'paid' | 'failed' | 'pending' | 'refunded'>; // server-to-server confirmation
  refund?(providerRef: string, amountAgorot: number): Promise<void>;
}
```

A `fake` provider is used in tests and the demo (no real money).

## 4. Architecture

- **Static menu stays static.** The published page gets a "Pay" button only when payments are enabled. It links to `/pay/<table-token>`, a separate server-rendered page with its own strict CSP that allows navigation only to the chosen provider (`form-action`/`frame-src` limited to that provider's domain).
- **Money is integers** (agorot), never floats. Amounts are always computed or confirmed on the server.
- **A payment is "paid" only after a server-to-server check** with the provider (webhook + status fetch), never because the browser came back to the success URL.
- **Idempotency:** a unique `payment_id` per attempt; repeated webhooks are no-ops; a double click does not open two charges.
- **Table tokens** are random (128-bit), not table numbers, so one table cannot see or pay another table's bill. A bill expires after closing or after N hours.
- **Staff screen** in the editor: open/close bills, see live status (paid / partly paid), refunds (owner only).

### Data model (new tables)

- `payment_settings`: provider, mode test/live, encrypted credentials (AES-256-GCM, key from env `PAYMENTS_KEY`, never sent to the browser), tip options, VAT/receipt settings.
- `tables`: id, label, token_hash, active.
- `bills`: id, table_id, amount_agorot, status, opened_by, opened_at, closed_at.
- `payments`: id, bill_id, amount_agorot, tip_agorot, provider, provider_ref, status, created_at, paid_at. No card data, no guest name unless the provider returns it for the receipt.
- `payment_events`: provider webhook log (hashed/minimal payload), for audit.

### API (new endpoints)

| Endpoint | Access |
|---|---|
| `GET/PUT /api/payments/settings` | owner |
| `POST /api/tables`, `GET /api/tables`, `POST /api/tables/:id/rotate-token` | owner/editor |
| `POST /api/bills`, `PATCH /api/bills/:id`, `POST /api/bills/:id/close` | editor (waiter) |
| `POST /api/payments/:id/refund` | owner |
| `GET /pay/:tableToken` | public (rate limited) |
| `POST /pay/:tableToken/checkout` | public (rate limited, CSRF token, idempotency key) |
| `POST /webhooks/payments/:provider` | public, signature-verified, no auth cookie |
| `GET /pay/return/:paymentId` | public, shows status read from the DB |

## 5. Security, privacy and legal

- **Threat model (summary):** fake "paid" via forged return URL → server-side verification; amount tampering → server-computed amounts; webhook spoofing → signature + status re-fetch; table enumeration → random tokens + rate limits; credential theft → encrypted at rest, owner-only, audit logged; clickjacking of the pay page → `frame-ancestors` limited to the restaurant's own tablet origin.
- **Card data:** never touches MenuAI (hosted pages only). Confirm SAQ type with the provider.
- **Receipts / tax invoices (Israel):** a business must issue a receipt; the provider's invoice module (or Green Invoice / iCount) should issue it. **Requires an accountant's check**, including the Israel Tax Authority "allocation number" rules for invoices above the threshold *(verify current threshold)*.
- **Consumer protection:** cancellation and refund policy shown before payment. **Requires legal review.**
- **Privacy (Amendment 13 / GDPR):** the provider is a separate controller/processor for card data; a DPA with the provider is needed; the privacy policy gets a payments section (draft). Retention: payment records kept as long as tax law requires *(accountant to confirm, typically 7 years)*; no marketing use.
- **Cookies:** the pay page sets no tracking cookies; a short-lived, strictly-necessary CSRF cookie only.
- **Accessibility:** pay page targets WCAG 2.1 AA: large touch targets, clear amounts, screen-reader announcements of status, RTL. The provider's hosted page is outside our control. Choose providers whose page states accessibility support *(verify)*.

## 6. Phases (each with tests and docs)

| Phase | Content |
|---|---|
| 3a ✅ | Adapter interface + `fake` provider, tables/bills/payments schema, staff screen, `/pay` page with tip/split, webhook pipeline, tests |
| 3b ✅ (code; sandbox run pending) | First real Israeli provider (sandbox) end to end |
| 3c ✅ PayPlus (code; sandbox run pending) | Second provider (PayPlus, signed callbacks). Stripe: Israeli business onboarding unclear, not built; PayPal: on request |
| 3d (in progress) | ✅ Resolving flagged payments, daily report by business day, CSV export (owner). ✅ **Refunds through the provider API** (owner; see §8). **Later:** receipts/tax invoices via the provider's invoice module or an accounting system (⚖️ accountant). |
| 3e ✅ (3e-1, 3e-2) | Order from the menu (flow B): cart on the published menu, waiter approval into the table's bill (§10). 3e-3 (kitchen display, sound, pay-first) later |

## 7. Out of scope (MVP)

Storing cards, recurring billing, cash handling, POS sync, kitchen display system.

## 8. Refunds through the provider API (Phase 3d)

Sources (checked 2026-10-29, *verify again in the sandbox run*):
- Grow `refundTransaction` (multipart: `userId`, `transactionId`, `transactionToken`, `refundSum`, optional `pageCode`): https://developers.grow.business/reference/refund-transaction. Rules (https://developers.grow.business/reference/refund-overview): a same-day refund is a cancellation of the whole transaction; at most 2 refunds per transaction through the API; no refund without a balance; the response layout is not published.
- PayPlus `Transactions/RefundByTransactionUID` (JSON: `transaction_uid`, `amount`; `api-key` + `secret-key` headers): https://docs.payplus.co.il/reference/post_transactions-refundbytransactionuid.

Design:
- **Owner only**, rate limited, audited. Amount in agorot, at most what was charged (share + tip) minus refunds that succeeded.
- **One refund in flight per payment**: the payment row is locked while the request is checked, and a partial unique index allows one `pending`/`unknown` refund per payment.
- The provider call happens **outside** any lock. Outcome: `succeeded`, `failed` (the provider said no; its error code is kept, nothing else), or **`unknown`** (network error/timeout: the refund may or may not have happened). An `unknown` refund blocks further refunds until the owner checks the provider's dashboard and confirms what happened. **We never retry a refund automatically** (a retry could refund twice).
- Refunds go through the provider and mode the payment was made with. If the owner switched provider or mode since, the refund is refused: refund in the old provider's dashboard and mark the payment handled.
- Provider handles needed for a refund (Grow `transactionId` + `transactionToken`, PayPlus transaction `uid`) are stored with the payment's provider identifiers when the payment is confirmed. They are not card data.
- Grow limits are enforced before calling: max 2 API refunds; same business day → full amount only.
- A refund does not change the bill (it is an adjustment after payment). A flagged payment that is fully refunded is marked handled automatically.
- Report: refunded amounts per business day (by refund date); CSV: refunded amount per payment.
- Live refunds are covered by the same sandbox run that unlocks live mode for a provider.

## 9. Receipts from the provider (Phase 3d)

MenuAI does **not** issue receipts or tax invoices itself. The business turns on its provider's invoice module, or the accounting system linked to it, in the provider's dashboard. The accountant decides the document type (⚖️). MenuAI then keeps the document's number and link so that the guest and staff can open it.

Sources (checked 2026-10-29, *verify in the sandbox run*):
- **Grow:** `createPaymentProcess` takes an optional `invoiceNotifyUrl`. Once the invoice is generated, Grow POSTs `transactionId`, `processId`, `invoiceNumber` and `invoiceUrl` there. The request format and any authentication are **not documented**: https://developers.grow.business/reference/invoice-server-response.
- **PayPlus:** the signed transaction callback carries `invoice` (`docu_number`, `original_url`, `copy_url`, `status`) when an invoice company is integrated: https://docs.payplus.co.il (transaction callback example). `initial_invoice` is not sent, so the payment page's own setting applies.

Design:
- **PayPlus:** the receipt comes inside the signed callback. Only `status: Success` with an `https` link is kept.
- **Grow:** the callback is unsigned, so `invoiceNotifyUrl` carries a per-payment 128-bit random key: `/api/payments/receipt/grow/<payment>/<key>`. The key is stored with the payment and compared in constant time. The body must also match the stored `processId`, and `transactionId` when we have it. The link must be `https` on Grow's own hosts. JSON or form bodies, as an object or a one-element array, are all accepted, because the format is undocumented. Path secrets are redacted from the app log and the nginx log.
- **Storage:** `receipt_number` and `receipt_url` on the payment (migration `0008`), first value wins. The link is a bearer link to a document held by the provider or the invoice company, and the document can show the payer's name. It is shown only on the paying guest's result page and on the staff screen.
- **Guest result page:** a "🧾 Receipt" link (new tab) once the receipt has arrived. Whether and how the provider also emails it follows its own settings.
- **Staff screen** shows the receipt number with its link. **CSV** gets a `receipt` column.

## 10. Phase 3e: Order from the menu (flow B): **approved 2026-10-30**, decision 1 = (a) the order is added to the table's bill; decision 2 = the waiter approves on the existing screen

### Goal
A guest at a table (tablet or phone) adds dishes from the published menu to a cart and sends the order. Staff see it on the payments screen. Payment then uses the existing table bill flow (or pays at once; see decision 1).

### User stories
- **Guest:** I pick dishes from the menu, choose a size where there is one, set quantities and add a short note ("no onion"). I see the total and send the order from the table.
- **Waiter:** new orders appear on my screen within seconds. I accept one (its items go onto the table's bill) or reject it with a reason the guest sees.
- **Owner:** I turn ordering on or off, choose which menu can be ordered from, and choose whether ordering needs an open bill.

### Decisions needed (the questions to you)
1. **Order → payment:**
   - **(a) recommended:** the order is added to the table's bill and paid with the existing flow (pay all, split, tip). The waiter approves every order, and nothing is charged before that.
   - **(b)** pay first: the guest pays for the order immediately, and the order goes to staff only after it is paid. This suits counters and takeaway, but needs automatic refunds when the kitchen rejects an order.
2. **Who approves orders:** the waiter on the existing screen (recommended for the MVP), or a separate kitchen screen (later).
3. **Add-ons with a price** (extra cheese +₪5): not in the MVP. The menu doesn't model them yet. Sizes (variants) and a free-text note are in.

### Architecture (for 3a, all server-side checks)
- **The published menu stays static.**
  - The "🛒" cart lives in the same `tablePay.js` runtime, which already knows the table from the URL fragment.
  - It is shown only on server-published menus, and only when ordering is on.
  - Sending an order is a `POST /t/<token>/order` with `[{itemId, variantId?, qty, note?}]`.
- **Prices are never trusted from the browser.**
  - The server loads the menu's **live published version** and checks that every item exists, is not hidden or sold out, and that the variant is valid.
  - It recomputes the price in agorot from that version (`price × 100`, rounded once).
  - Limits per order: up to 30 lines, up to 20 of each item, and a note of up to 140 characters per line.
- **Rate limits per table token and per IP, plus an idempotency key per order** (a double tap creates one order).
- **The CSP of menu pages** gets `connect-src 'self'` for this one endpoint. Everything else is unchanged.
- **Tables (migration):**
  - `orders`: id, table, status (`new`, `accepted`, `rejected`), the total computed by the server, the menu version id, times, accepted_by;
  - `order_lines`: item and variant ids, a name snapshot in the guest's language, unit price, quantity, note.
- **On accept (decision 1a):**
  - the order's total is added to the table's open bill, or a new bill is opened, under the bill row lock, with the same rules as checkout;
  - the bill's note lists the lines;
  - the guest's page polls the order status and shows accepted or rejected.
- **Staff screen:**
  - an **Orders** section that refreshes every 5 s, with an optional sound and a visible "new" badge (not color only);
  - it shows the lines and notes;
  - Accept / Reject (with a reason) are editor actions and are audited.

### Security, privacy, accessibility
- **Threat model:**
  - price tampering → server-side recomputation;
  - spam orders from a leaked QR → per-table rate limits, waiter approval, and the existing **Replace QR code**;
  - XSS in notes → plain text, escaped everywhere and length-limited;
  - another table's orders → every query is scoped to the table token.
- **Privacy:** an order holds no personal data. Notes are free text, so the UI asks not to write personal details. Retention follows the bill's.
- **Accessibility:**
  - the cart is a labelled dialog with focus management;
  - quantity steppers are buttons with names and a live total, with 44 px targets;
  - RTL;
  - order status is announced with `role="status"`.
- ⚖️ Food allergen information remains the restaurant's responsibility. The cart repeats each item's allergen tags but makes no claims.

### Files (estimate)
- **Server:**
  - `server/src/orders/{service,routes,guest}.ts`
  - migration `0009_orders`
  - tests
- **Client:**
  - `src/renderer/tablePay.js` (cart)
  - `src/core/exportHtml.ts` (CSP/runtime)
  - `src/pages/PaymentsPage.tsx` (Orders section)
  - `src/api/orders.ts`
  - i18n in he/en/ar
- **Docs:** `docs/PAYMENTS.md`, CHANGELOG, data map, checklist.

### Phases
- **3e-1:** order model, the guest endpoint with server-side pricing, the staff Orders section with accept or reject, and the bill integration (1a). Includes tests, a browser check and axe.
- **3e-2:** the cart UI on the menu, and order status for the guest.
- **3e-3 (optional):** kitchen display, sound alerts, and pay-first mode (1b) with automatic refund on reject.
