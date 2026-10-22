import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SqlClient } from '../db/sql';
import { badRequest, conflict, notFound } from '../errors';
import { loginMail } from '../mail/templates';
import { requireRole } from '../auth/guard';
import { ROLES, type Role } from '../auth/roles';
import { emailSchema } from '../auth/routes';
import { audit, INVITE_LINK_MINUTES, issueLoginToken, loginLink, normalizeEmail, revokeAllSessions } from '../auth/service';

const nameSchema = z.string().trim().max(120);
const idSchema = z.uuid();

interface Row {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled_at: Date | null;
  created_at: Date;
}

const toDto = (r: Row) => ({
  id: r.id, email: r.email, name: r.name, role: r.role, disabled: r.disabled_at !== null, createdAt: r.created_at,
});

async function activeOwnerCount(db: SqlClient, exceptId: string): Promise<number> {
  const [row] = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM users WHERE role = 'owner' AND disabled_at IS NULL AND id <> $1",
    [exceptId],
  );
  return Number(row?.n ?? 0);
}

export async function userRoutes(app: FastifyInstance) {
  const { db, config, mailer } = app.deps;
  const ownerOnly = { preHandler: requireRole('owner') };

  /** Sends a sign-in link, or returns it when no email provider is configured (owner shares it by hand). */
  async function deliverInvite(user: { id: string; email: string }): Promise<string | undefined> {
    const token = await issueLoginToken(db, user.id, INVITE_LINK_MINUTES);
    if (!token) throw conflict('too_many_links');
    const link = loginLink(config.PUBLIC_URL, token);
    if (!mailer.configured) return link;
    await mailer.send(loginMail(user.email, link, 'invite', INVITE_LINK_MINUTES));
    return undefined;
  }

  app.get('/api/users', ownerOnly, async () => {
    const rows = await db.query<Row>('SELECT id, email, name, role, disabled_at, created_at FROM users ORDER BY created_at');
    return { users: rows.map(toDto) };
  });

  app.post('/api/users', ownerOnly, async (req, reply) => {
    const parsed = z
      .object({ email: emailSchema, name: nameSchema.default(''), role: z.enum(ROLES) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) throw badRequest();
    const { email, name, role } = parsed.data;
    const [existing] = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [normalizeEmail(email)]);
    if (existing) throw conflict('email_taken');
    const [row] = await db.query<Row>(
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id, email, name, role, disabled_at, created_at',
      [normalizeEmail(email), name, role],
    );
    await audit(db, { userId: req.user!.id, action: 'user.invite', targetType: 'user', targetId: row!.id, meta: { role } });
    const inviteLink = await deliverInvite(row!);
    return reply.status(201).send({ user: toDto(row!), ...(inviteLink ? { inviteLink } : {}) });
  });

  app.patch('/api/users/:id', ownerOnly, async (req) => {
    const id = idSchema.safeParse((req.params as { id: string }).id);
    const body = z
      .object({ name: nameSchema.optional(), role: z.enum(ROLES).optional(), disabled: z.boolean().optional() })
      .strict()
      .safeParse(req.body);
    if (!id.success || !body.success) throw badRequest();
    const [target] = await db.query<Row>('SELECT id, email, name, role, disabled_at, created_at FROM users WHERE id = $1', [id.data]);
    if (!target) throw notFound();
    const changes = body.data;
    const losesOwner =
      target.role === 'owner' && target.disabled_at === null &&
      ((changes.role !== undefined && changes.role !== 'owner') || changes.disabled === true);
    // The business must never be left without an active owner (no one could manage it).
    if (losesOwner && (await activeOwnerCount(db, target.id)) === 0) throw conflict('last_owner');

    const [row] = await db.query<Row>(
      `UPDATE users SET
         name = COALESCE($2, name),
         role = COALESCE($3::user_role, role),
         disabled_at = CASE WHEN $4::boolean IS NULL THEN disabled_at WHEN $4 THEN COALESCE(disabled_at, now()) ELSE NULL END
       WHERE id = $1
       RETURNING id, email, name, role, disabled_at, created_at`,
      [target.id, changes.name ?? null, changes.role ?? null, changes.disabled ?? null],
    );
    if (changes.disabled === true) await revokeAllSessions(db, target.id);
    await audit(db, { userId: req.user!.id, action: 'user.update', targetType: 'user', targetId: target.id, meta: { fields: Object.keys(changes) } });
    return { user: toDto(row!) };
  });

  app.post('/api/users/:id/invite', ownerOnly, async (req) => {
    const id = idSchema.safeParse((req.params as { id: string }).id);
    if (!id.success) throw badRequest();
    const [target] = await db.query<Row>(
      'SELECT id, email, name, role, disabled_at, created_at FROM users WHERE id = $1 AND disabled_at IS NULL',
      [id.data],
    );
    if (!target) throw notFound();
    const inviteLink = await deliverInvite(target);
    await audit(db, { userId: req.user!.id, action: 'user.reinvite', targetType: 'user', targetId: target.id });
    return { ok: true, ...(inviteLink ? { inviteLink } : {}) };
  });
}
