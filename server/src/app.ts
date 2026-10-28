/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import type { Config } from './config';
import type { SqlClient } from './db/sql';
import { forbidden, HttpError } from './errors';
import type { Mailer } from './mail/mailer';
import { authRoutes } from './auth/routes';
import { userRoutes } from './users/routes';
import { menuRoutes } from './menus/routes';
import { publishRoutes, sendMenuNotFound } from './publish/routes';
import { createFileStore, type PublishStore } from './publish/store';
import { uploadRoutes } from './uploads/routes';
import { paymentRoutes } from './payments/routes';
import { guestPaymentRoutes, NOTIFY_ROUTE } from './payments/guest';
import { applyRetention } from './maintenance/retention';
import { createMediaStore, type MediaStore } from './uploads/store';
import { clamdScanner, unscanned, type Scanner } from './uploads/clamd';

export interface AppDeps {
  config: Config;
  db: SqlClient;
  mailer: Mailer;
  /** Where logs go (default stdout). Redaction always applies, whatever the destination. */
  logStream?: Writable;
  /** Published menu files (default: PUBLISH_DIR on disk). */
  publishStore?: PublishStore;
  /** Uploaded images (default: UPLOAD_DIR on disk). */
  mediaStore?: MediaStore;
  /** Virus scanner for uploads (default: clamd at CLAMAV_URL; null disables uploads). */
  scanner?: Scanner | null;
  /** HTTP client for payment provider APIs (default: global fetch; tests pass a fake provider server). */
  paymentHttp?: typeof fetch;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/**
 * Strips the query string so one-time tokens (e.g. ?token=) never reach the logs, and the table code
 * from pay-at-the-table paths (/t/<code>/…: it is the table's key).
 */
export function safeUrl(url: string): string {
  const i = url.indexOf('?');
  const path = (i === -1 ? url : url.slice(0, i)).replace(/^\/t\/[^/]+/, '/t/[table]');
  return i === -1 ? path : `${path}?[redacted]`;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    // Trust exactly N proxy hops (nginx on the same host = 1) so client IPs can't be spoofed via X-Forwarded-For.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 1024 * 1024,
    // Slow or stalled clients are cut off instead of holding sockets open (slowloris).
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
    genReqId: () => crypto.randomUUID(),
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      serializers: {
        req: (req) => ({ method: req.method, url: safeUrl(req.url), id: req.id }),
      },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
  });
  app.decorate('deps', deps);

  // The API only ever returns JSON: lock everything else down.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'rate_limited' }),
  });
  await app.register(cookie);
  // Responses carry private data (menus, users): never store them in browser or proxy caches.
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited' });
    if (status === 413) return reply.status(413).send({ error: 'payload_too_large' });
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'bad_request' });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error' });
  });
  // Unknown routes are rate-limited too, so scanners probing random paths get throttled.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) =>
    req.url.startsWith('/m/') ? sendMenuNotFound(reply) : reply.status(404).send({ error: 'not_found' }),
  );

  // Rate-limited like every route: it touches the database, so it must not be a free amplifier.
  // CSRF defense in depth (on top of SameSite=Strict cookies): data-changing requests must come
  // from our own origin. Browsers always send Origin on POST/PUT/PATCH/DELETE.
  const allowedOrigin = new URL(config.PUBLIC_URL).origin;
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    // Payment providers call this server-to-server (no browser, no Origin). It changes nothing on its
    // own say-so: every notification is checked with the provider first (payments/service.ts).
    // Matched by route (not by URL prefix), so no path trick can carry the exemption to another endpoint.
    if (req.routeOptions.url === NOTIFY_ROUTE) return;
    if (req.headers.origin !== allowedOrigin) throw forbidden();
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  const store = deps.publishStore ?? createFileStore(config.PUBLISH_DIR);
  await app.register(menuRoutes, { store });
  await app.register(publishRoutes, { store });

  const media = deps.mediaStore ?? createMediaStore(config.UPLOAD_DIR);
  const scanner =
    deps.scanner !== undefined ? deps.scanner
    : config.CLAMAV_URL ? clamdScanner(config.CLAMAV_URL)
    : config.UPLOADS_ALLOW_UNSCANNED ? unscanned
    : null;
  if (!scanner) app.log.warn('CLAMAV_URL is not set: image uploads are disabled (every upload must be virus scanned).');
  await app.register(uploadRoutes, { media, scanner });
  await app.register(paymentRoutes);
  await app.register(guestPaymentRoutes);

  // Daily retention run: expired tokens and sessions, old audit entries, unused images.
  if (config.NODE_ENV !== 'test') {
    const sweep = () =>
      applyRetention(deps.db, media)
        .then((report) => app.log.info({ retention: report }, 'retention applied'))
        .catch((err: unknown) => app.log.error({ err }, 'retention run failed'));
    let timer: ReturnType<typeof setInterval> | undefined;
    app.addHook('onReady', async () => {
      void sweep();
      timer = setInterval(sweep, 24 * 60 * 60 * 1000);
      timer.unref();
    });
    app.addHook('onClose', async () => clearInterval(timer));
  }

  app.get('/api/health', async (_req, reply) => {
    try {
      await deps.db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
