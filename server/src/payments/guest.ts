/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SqlClient } from '../db/sql';
import { HttpError } from '../errors';
import { publicUrl } from '../publish/routes';
import { decimalToAgorot, remainingAgorot, shareChoiceSchema, tipChoiceSchema, type ShareChoice, type TipChoice } from './money';
import { demoProviderPage, guestCsp, pickLocale, resultPage, tableNotFoundPage, tablePage, type GuestErrorCode, type GuestLocale } from './pages';
import { PROVIDER_IDS, ProviderError, type Payer, type ProviderRef } from './providers/types';
import {
  activeProvider, configuredProvider, handleNotification, loadPayment, openBillForTable, startCheckout, tableByToken, totalsOf, verifyPayment,
  type GuestTable,
} from './service';

/** Provider notifications arrive on this route (exempt from the browser Origin check in app.ts). */
export const NOTIFY_ROUTE = '/api/payments/notify/:provider';

/** Guests wait this long on "confirming…" before the page says it is taking longer than usual. */
const PENDING_PATIENCE_MS = 60_000;

interface MenuInfo {
  restaurant: string | null;
  menuUrl: string | null;
  defaultLocale: string | null;
}

/** The table's menu as published (never the unpublished draft): its name and public address. */
async function menuInfo(db: SqlClient, publicBase: string, menuId: string | null, locale?: string): Promise<MenuInfo> {
  if (!menuId) return { restaurant: null, menuUrl: null, defaultLocale: null };
  const [row] = await db.query<{ public_slug: string; title: Record<string, string>; default_locale: string }>(
    `SELECT p.public_slug, v.data->'title' AS title, v.data->>'defaultLocale' AS default_locale
     FROM publications p JOIN menu_versions v ON v.id = p.version_id WHERE p.menu_id = $1`,
    [menuId],
  );
  if (!row) return { restaurant: null, menuUrl: null, defaultLocale: null };
  const title = (locale && row.title?.[locale]) || row.title?.[row.default_locale] || null;
  return { restaurant: title, menuUrl: publicUrl(publicBase, row.public_slug), defaultLocale: row.default_locale };
}

/** "Description" sent to the provider: letters, digits and spaces only (Grow rejects special characters). */
export function plainDescription(text: string): string {
  return text.normalize('NFC').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Bill';
}

const payerSchema = z.object({
  // At least two names (Grow requires first and last name).
  fullName: z.string().trim().min(3).max(80).regex(/^[\p{L}'’. -]+$/u).refine((v) => v.split(/\s+/).filter(Boolean).length >= 2),
  // Israeli mobile, digits only after stripping spaces/dashes: 05XXXXXXXX.
  phone: z.string().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^05\d{8}$/)),
});

function parseForm(body: Record<string, string>): { share: ShareChoice; tip: TipChoice } | 'invalid_share' | 'invalid_tip' {
  const shareKind = body.share ?? 'full';
  const share = shareChoiceSchema.safeParse(
    shareKind === 'custom' ? { kind: 'custom', agorot: decimalToAgorot(body.shareAmount) ?? -1 }
    : shareKind === 'split' ? { kind: 'split', parts: body.parts }
    : { kind: shareKind },
  );
  if (!share.success) return 'invalid_share';
  const tipKind = body.tip ?? 'none';
  const tip = tipChoiceSchema.safeParse(
    tipKind === 'none' ? { kind: 'none' }
    : tipKind === 'custom' ? (decimalToAgorot(body.tipAmount) === 0 ? { kind: 'none' } : { kind: 'custom', agorot: decimalToAgorot(body.tipAmount) ?? -1 })
    : { kind: 'percent', percent: tipKind },
  );
  if (!tip.success) return 'invalid_tip';
  return { share: share.data, tip: tip.data };
}

export async function guestPaymentRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const base = config.PUBLIC_URL.endsWith('/') ? config.PUBLIC_URL : `${config.PUBLIC_URL}/`;
  const abs = (path: string) => new URL(path.replace(/^\//, ''), base).toString();

  // Plain HTML forms (they work without JavaScript) and providers that post urlencoded notifications.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    const params = new URLSearchParams(body as string);
    const out: Record<string, string> = {};
    // First value wins; keys are capped so a crafted body can't build a huge object.
    for (const [k, v] of params) if (!(k in out) && Object.keys(out).length < 100) out[k] = v;
    done(null, out);
  });

  // Grow posts its server update "the same way as createPaymentProcess": multipart/form-data. Text
  // fields only (no files), small, parsed by the platform's own FormData parser.
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: 32 * 1024 }, (req, body, done) => {
    new Response(new Uint8Array(body as Buffer), { headers: { 'content-type': req.headers['content-type'] ?? '' } })
      .formData()
      .then((form) => {
        const out: Record<string, string> = {};
        for (const [k, v] of form) if (typeof v === 'string' && !(k in out) && Object.keys(out).length < 100) out[k] = v;
        done(null, out);
      })
      .catch(() => done(Object.assign(new Error('bad form'), { statusCode: 400 }), undefined));
  });

  const sendHtml = (reply: FastifyReply, html: string, formOrigins: readonly string[] = [], status = 200) =>
    reply
      .status(status)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      // same-origin (not no-referrer): browsers then send a real Origin header on our form posts.
      .header('referrer-policy', 'same-origin')
      .header('content-security-policy', guestCsp(formOrigins))
      .send(html);

  // Guest pages are not logged (the table token in the path is the table's key).
  const guestRoute = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, logLevel: 'warn' as const };

  async function renderTable(req: FastifyRequest, reply: FastifyReply, table: GuestTable, extra: { error?: GuestErrorCode; values?: Record<string, string> } = {}, status = 200) {
    const query = req.query as { lang?: string };
    const requested = (req.body as Record<string, string> | undefined)?.lang ?? query.lang;
    const info0 = await menuInfo(db, config.PUBLIC_URL, table.menuId);
    const locale = pickLocale(requested, info0.defaultLocale, req.headers['accept-language']);
    const info = await menuInfo(db, config.PUBLIC_URL, table.menuId, locale);
    const selfPath = `/t/${(req.params as { token: string }).token}`;
    const active = await activeProvider(db, config, app.deps.paymentHttp);
    const token = (req.params as { token: string }).token;
    // The menu opens in the guest's language, carrying the table code in the fragment (never sent to a
    // server) so the published menu can show a "Pay the bill" button back to this page (tablePay.js).
    const menuUrl = info.menuUrl ? `${info.menuUrl}?lang=${locale}#table=${token}` : null;
    const common = { locale, tableLabel: table.label, restaurant: info.restaurant, menuUrl, selfPath };
    if (!active) return sendHtml(reply, tablePage({ ...common, state: { kind: 'unavailable' } }), [], status);
    const bill = await openBillForTable(db, table.id);
    if (!bill) {
      // Just paid in full? Show a thank-you rather than "no bill".
      // Only the table's latest bill counts: a later bill closed by staff must not show an old thank-you.
      const [latest] = await db.query<{ amount_agorot: number; status: string; closed_at: Date | null }>(
        "SELECT amount_agorot, status, closed_at FROM bills WHERE table_id = $1 ORDER BY opened_at DESC LIMIT 1",
        [table.id],
      );
      const recent = latest?.status === 'paid' && latest.closed_at && Date.now() - new Date(latest.closed_at).getTime() < 15 * 60_000 ? latest : null;
      const state = recent ? ({ kind: 'paid', amount: recent.amount_agorot } as const) : ({ kind: 'no_bill' } as const);
      return sendHtml(reply, tablePage({ ...common, state }), [], status);
    }
    const remaining = remainingAgorot(totalsOf(bill));
    return sendHtml(
      reply,
      tablePage({
        ...common,
        state: {
          kind: 'open',
          amount: bill.amount_agorot,
          paid: bill.paid_agorot,
          remaining,
          tipPercents: active.settings.tipPercents,
          requiresPayer: active.provider.requiresPayer,
          testMode: active.settings.mode === 'test',
          termsUrl: active.settings.termsUrl,
          ...extra,
        },
      }),
      active.provider.checkoutOrigins,
      status,
    );
  }

  // An unknown or replaced table code (e.g. an old printed QR): a friendly page, not the API's JSON.
  const notFoundPage = (reply: FastifyReply, req?: FastifyRequest) =>
    sendHtml(reply, tableNotFoundPage(pickLocale((req?.query as { lang?: string } | undefined)?.lang, null, req?.headers['accept-language'])), [], 404);

  app.get('/t/:token', guestRoute, async (req, reply) => {
    const table = await tableByToken(db, (req.params as { token: string }).token);
    if (!table) return notFoundPage(reply, req);
    return renderTable(req, reply, table);
  });

  app.post('/t/:token/pay', { ...guestRoute, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const table = await tableByToken(db, token);
    if (!table) return notFoundPage(reply, req);
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    // Echo back what the guest typed (never card data: there is none here) so a fix needs no retyping.
    const values = Object.fromEntries(['share', 'parts', 'shareAmount', 'tip', 'tipAmount', 'fullName', 'phone', 'agree'].filter((k) => typeof body[k] === 'string').map((k) => [k, body[k]!.slice(0, 80)]));
    const fail = (error: GuestErrorCode, status = 400) => renderTable(req, reply, table, { error, values }, status);

    const active = await activeProvider(db, config, app.deps.paymentHttp);
    if (!active) return renderTable(req, reply, table);
    const choice = parseForm(body);
    if (typeof choice === 'string') return fail(choice);
    if (active.settings.termsUrl && body.agree !== 'yes') return fail('terms_required');
    let payer: Payer = { fullName: '', phone: '' };
    if (active.provider.requiresPayer) {
      const parsed = payerSchema.safeParse({ fullName: body.fullName ?? '', phone: body.phone ?? '' });
      if (!parsed.success) return fail('invalid_payer');
      payer = parsed.data;
    }
    const info = await menuInfo(db, config.PUBLIC_URL, table.menuId);
    const locale: GuestLocale = pickLocale(body.lang, info.defaultLocale, req.headers['accept-language']);
    try {
      const result = await startCheckout(db, active, {
        table,
        share: choice.share,
        tip: choice.tip,
        payer,
        locale,
        description: plainDescription(`${info.restaurant ?? 'Restaurant'} table ${table.label}`),
        urls: (paymentId) => ({
          successUrl: abs(`/t/${token}/done/${paymentId}?lang=${locale}`),
          cancelUrl: abs(`/t/${token}?lang=${locale}`),
          notifyUrl: abs(`/api/payments/notify/${active.provider.id}`),
        }),
      });
      return reply.status(303).header('cache-control', 'no-store').redirect(result.redirectUrl);
    } catch (err) {
      if (err instanceof HttpError && ['nothing_to_pay', 'invalid_share', 'invalid_tip', 'provider_unavailable'].includes(err.code)) {
        return fail(err.code as GuestErrorCode, err.statusCode);
      }
      if (err instanceof HttpError && err.statusCode === 404) return renderTable(req, reply, table);
      throw err;
    }
  });

  // Where the provider sends the guest back. The page shows what the *server* knows, after asking the provider.
  app.get('/t/:token/done/:paymentId', guestRoute, async (req, reply) => {
    const { token, paymentId } = req.params as { token: string; paymentId: string };
    const table = await tableByToken(db, token);
    const payment = table ? await loadPayment(db, paymentId) : null;
    if (!table || !payment) return notFoundPage(reply, req);
    // The payment must belong to this table's bill (no peeking at other tables' payments).
    const [own] = await db.query('SELECT 1 FROM bills WHERE id = $1 AND table_id = $2', [payment.bill_id, table.id]);
    if (!own) return notFoundPage(reply, req);
    const info = await menuInfo(db, config.PUBLIC_URL, table.menuId);
    const locale = pickLocale((req.query as { lang?: string }).lang, info.defaultLocale, req.headers['accept-language']);
    const back = `/t/${token}?lang=${locale}`;

    let status: string = payment.status;
    // Not only "pending": an expired or failed checkout may still have been charged (e.g. the guest
    // retried on the provider's page). Ask before telling anyone they were not charged.
    if (status !== 'paid') {
      const active = await configuredProvider(db, config, app.deps.paymentHttp);
      if (active && active.provider.id === payment.provider) {
        try {
          status = await verifyPayment(db, active.provider, payment, 'return');
        } catch (err) {
          req.log.warn({ reason: err instanceof Error ? err.message : 'unknown' }, 'payment status check failed');
        }
      }
    }
    if (status === 'paid') return sendHtml(reply, resultPage(locale, back, { kind: 'paid', agorot: payment.share_agorot + payment.tip_agorot }));
    if (status === 'failed' || status === 'expired') return sendHtml(reply, resultPage(locale, back, { kind: 'failed' }));
    const long = Date.now() - new Date(payment.created_at).getTime() > PENDING_PATIENCE_MS;
    return sendHtml(reply, resultPage(locale, back, { kind: 'pending', long }));
  });

  // Server-to-server notifications from providers. No session, no Origin: authenticity comes from
  // the per-payment secret plus a status check with the provider (see handleNotification).
  app.post(NOTIFY_ROUTE, { config: { rateLimit: { max: 300, timeWindow: '1 minute' } }, logLevel: 'warn' }, async (req, reply) => {
    const providerId = (req.params as { provider: string }).provider;
    if (!(PROVIDER_IDS as readonly string[]).includes(providerId)) return reply.status(404).send({ error: 'not_found' });
    // Even with payments switched off: a guest who already paid must still be recorded.
    const active = await configuredProvider(db, config, app.deps.paymentHttp);
    // Always 200 for well-formed requests we chose to ignore, so providers don't retry forever.
    if (!active || active.provider.id !== providerId) return reply.send({ ok: true });
    try {
      const outcome = await handleNotification(db, active.provider, req.body, (n) => (n.paymentId ? loadPayment(db, n.paymentId) : Promise.resolve(null)));
      return reply.send({ ok: true, outcome });
    } catch (err) {
      // The provider's status API is unreachable: answer "try later" (providers resend updates).
      if (!(err instanceof ProviderError)) throw err;
      req.log.warn({ provider: providerId, reason: err.message }, 'payment status check failed; provider will retry');
      return reply.status(503).send({ error: 'provider_unavailable' });
    }
  });

  // --- demo provider (development only; never in production) --------------------------------------

  async function demoPayment(req: FastifyRequest) {
    if (!config.PAYMENTS_ALLOW_FAKE) return null;
    const active = await activeProvider(db, config, app.deps.paymentHttp);
    if (active?.provider.id !== 'fake') return null;
    const payment = await loadPayment(db, (req.params as { paymentId: string }).paymentId);
    return payment && payment.provider === 'fake' ? { payment, provider: active.provider } : null;
  }

  app.get('/pay/demo/:paymentId', guestRoute, async (req, reply) => {
    const demo = await demoPayment(req);
    if (!demo) return notFoundPage(reply, req);
    const locale = pickLocale((req.query as { lang?: string }).lang, null, req.headers['accept-language']);
    return sendHtml(reply, demoProviderPage(locale, `/pay/demo/${demo.payment.id}`, demo.payment.share_agorot + demo.payment.tip_agorot));
  });

  app.post('/pay/demo/:paymentId', guestRoute, async (req, reply) => {
    const demo = await demoPayment(req);
    if (!demo) return notFoundPage(reply, req);
    const { payment, provider } = demo;
    const outcome = (req.body as Record<string, string> | undefined)?.outcome === 'paid' ? 'paid' : 'declined';
    if (payment.status === 'pending' && !payment.provider_ref.outcome) {
      const ref: ProviderRef = { ...payment.provider_ref, outcome, ...(outcome === 'paid' ? { txn: `DEMO-${payment.id.slice(0, 8).toUpperCase()}` } : {}) };
      await db.query('UPDATE payments SET provider_ref = $2 WHERE id = $1', [payment.id, JSON.stringify(ref)]);
      // Like a real provider: notify the server, then send the browser back.
      await handleNotification(db, provider, { paymentId: payment.id, demoSecret: ref.demoSecret }, (n) => loadPayment(db, n.paymentId!));
    }
    const target = outcome === 'paid' ? payment.provider_ref.successUrl : payment.provider_ref.cancelUrl;
    return reply.status(303).redirect(target ?? '/');
  });
}
