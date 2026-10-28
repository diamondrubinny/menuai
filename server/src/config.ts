/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    /** Public base URL of the editor, used in login links and published menu URLs. */
    PUBLIC_URL: z.url(),
    /** Number of trusted reverse proxies in front of the API (nginx on the same host = 1). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    PUBLISH_DIR: z.string().default('/var/lib/menuai/published'),
    UPLOAD_DIR: z.string().default('/var/lib/menuai/uploads'),
    SMTP_URL: z.string().regex(/^smtps?:\/\//, 'must be smtp:// or smtps://').optional(),
    MAIL_FROM: z.string().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    SECURE_COOKIES: bool.optional(),
    /** clamd for virus scanning uploads, e.g. tcp://clamav:3310. Without it, uploads are disabled. */
    CLAMAV_URL: z.string().regex(/^tcp:\/\/[A-Za-z0-9.-]+:\d{1,5}$/, 'must be tcp://host:port').optional(),
    /** Development only: accept uploads without a virus scan. Refused in production. */
    UPLOADS_ALLOW_UNSCANNED: bool.default(false),
    UPLOAD_QUOTA_MB: z.coerce.number().int().min(1).max(1_000_000).default(2048),
    /** 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts payment provider credentials. Without it, payments are off. */
    PAYMENTS_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 (openssl rand -base64 32)')
      .optional(),
    /** Development only: the built-in demo provider that takes no real money. Refused in production. */
    PAYMENTS_ALLOW_FAKE: bool.default(false),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'must use https:// in production' });
    }
    if (c.NODE_ENV === 'production' && c.UPLOADS_ALLOW_UNSCANNED) {
      ctx.addIssue({ code: 'custom', path: ['UPLOADS_ALLOW_UNSCANNED'], message: 'is not allowed in production (every upload must be virus scanned)' });
    }
    if (c.NODE_ENV === 'production' && c.PAYMENTS_ALLOW_FAKE) {
      ctx.addIssue({ code: 'custom', path: ['PAYMENTS_ALLOW_FAKE'], message: 'is not allowed in production (the demo provider takes no real money)' });
    }
    if (c.SMTP_URL && !c.MAIL_FROM) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'required when SMTP_URL is set' });
    }
  });

export type Config = z.infer<typeof configSchema> & { SECURE_COOKIES: boolean };

/** Validates environment variables. Throws a readable error that never echoes secret values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // `KEY=` in .env / compose arrives as an empty string: treat it as "not set" so optional
  // settings (like SMTP before a provider is chosen) can be left blank as documented.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const result = configSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const c = result.data;
  return { ...c, SECURE_COOKIES: c.SECURE_COOKIES ?? c.NODE_ENV === 'production' };
}
