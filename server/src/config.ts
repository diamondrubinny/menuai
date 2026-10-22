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
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'must use https:// in production' });
    }
    if (c.SMTP_URL && !c.MAIL_FROM) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'required when SMTP_URL is set' });
    }
  });

export type Config = z.infer<typeof configSchema> & { SECURE_COOKIES: boolean };

/** Validates environment variables. Throws a readable error that never echoes secret values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const c = result.data;
  return { ...c, SECURE_COOKIES: c.SECURE_COOKIES ?? c.NODE_ENV === 'production' };
}
