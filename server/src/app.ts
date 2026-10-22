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

export interface AppDeps {
  config: Config;
  db: SqlClient;
  mailer: Mailer;
  /** Where logs go (default stdout). Redaction always applies, whatever the destination. */
  logStream?: Writable;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** Strips the query string so one-time tokens (e.g. ?token=) never reach the logs. */
function safeUrl(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : `${url.slice(0, i)}?[redacted]`;
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
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (_req, reply) => reply.status(404).send({ error: 'not_found' }));

  // Rate-limited like every route: it touches the database, so it must not be a free amplifier.
  // CSRF defense in depth (on top of SameSite=Strict cookies): data-changing requests must come
  // from our own origin. Browsers always send Origin on POST/PUT/PATCH/DELETE.
  const allowedOrigin = new URL(config.PUBLIC_URL).origin;
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (req.headers.origin !== allowedOrigin) throw forbidden();
  });

  await app.register(authRoutes);
  await app.register(userRoutes);

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
