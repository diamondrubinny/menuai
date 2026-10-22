import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../errors';
import { loginMail } from '../mail/templates';
import { requireRole, SESSION_COOKIE } from './guard';
import {
  audit, findActiveUserByEmail, issueLoginToken, LOGIN_LINK_MINUTES, loginLink,
  redeemLoginToken, revokeSession, SESSION_DAYS,
} from './service';

// Trim first: addresses are often pasted with surrounding spaces.
export const emailSchema = z.string().trim().pipe(z.email().max(254));

export async function authRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.deps;
  const cookieOptions = {
    path: '/api',
    httpOnly: true,
    secure: config.SECURE_COOKIES,
    sameSite: 'strict' as const,
  };

  app.post('/api/auth/request-link', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_email');
    const user = await findActiveUserByEmail(db, parsed.data.email);
    if (user) {
      const token = await issueLoginToken(db, user.id, LOGIN_LINK_MINUTES);
      if (token) {
        if (mailer.configured) {
          // Not awaited: the response time must not reveal whether the address exists.
          mailer
            .send(loginMail(user.email, loginLink(config.PUBLIC_URL, token), 'login', LOGIN_LINK_MINUTES))
            .catch((err: unknown) => req.log.error({ err: (err as Error).message }, 'login email failed'));
        } else {
          req.log.warn('login link requested but no SMTP is configured; use the CLI (login-link) instead');
        }
      }
    }
    // Same answer whether or not the address exists (no account enumeration).
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = (req.body as { token?: unknown } | null)?.token;
    const result = await redeemLoginToken(db, token, String(req.headers['user-agent'] ?? ''));
    if (!result) throw badRequest('invalid_or_expired');
    await audit(db, { userId: result.user.id, action: 'auth.login' });
    reply.setCookie(SESSION_COOKIE, result.sessionToken, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 });
    return { user: result.user };
  });

  app.post('/api/auth/sign-out', async (req, reply) => {
    await revokeSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/api/me', { preHandler: requireRole('viewer') }, async (req) => ({ user: req.user }));
}
