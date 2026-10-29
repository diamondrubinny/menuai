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
| 3e (optional) | Order-and-pay cart (flow B) |

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
