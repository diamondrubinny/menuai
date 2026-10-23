/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseMenu, type Menu } from '../../../src/core/schema';
import type { SqlClient } from '../db/sql';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { publicUrl } from '../publish/routes';
import type { PublishStore } from '../publish/store';

/** Menus can embed images as data URLs until uploads land (Phase 2e), so they get a larger body limit. */
export const MENU_BODY_LIMIT = 12 * 1024 * 1024;
/** One installation = one business; this is far above any real need and caps abuse. */
export const MAX_MENUS = 200;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const idSchema = z.uuid();
const slugSchema = z.string().regex(SLUG_RE);

interface MenuRow {
  id: string;
  slug: string;
  draft: Menu;
  draft_version: number;
  updated_at: Date;
  updated_by_name: string | null;
}

type SummaryRow = Omit<MenuRow, 'draft'> & { title: string | null; public_slug: string | null };

const summary = (r: SummaryRow, publicBase: string) => ({
  id: r.id,
  slug: r.slug,
  title: r.title ?? '',
  publicUrl: r.public_slug ? publicUrl(publicBase, r.public_slug) : null,
  draftVersion: r.draft_version,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by_name,
});

const full = (r: MenuRow) => ({
  id: r.id,
  slug: r.slug,
  draftVersion: r.draft_version,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by_name,
  draft: r.draft,
});

const SELECT_FULL = `
  SELECT m.id, m.slug, m.draft, m.draft_version, m.updated_at, u.name AS updated_by_name
  FROM menus m LEFT JOIN users u ON u.id = m.updated_by`;

/** A URL-safe slug from the menu title (Latin letters/digits only; other scripts fall back to "menu"). */
export function slugFromMenu(menu: Menu): string {
  const title = menu.title.en ?? menu.title[menu.defaultLocale] ?? '';
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base || 'menu';
}

async function uniqueSlug(db: SqlClient, base: string): Promise<string> {
  const rows = await db.query<{ slug: string }>(
    "SELECT slug FROM menus WHERE slug = $1 OR slug LIKE $1 || '-%'",
    [base],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

function parseId(req: FastifyRequest): string {
  const id = idSchema.safeParse((req.params as { id: string }).id);
  if (!id.success) throw notFound();
  return id.data;
}

function parseDraft(input: unknown): Menu {
  const result = parseMenu(input);
  if (!result.ok) throw badRequest('invalid_menu');
  return result.menu;
}

/** Accepts `"3"`, `W/"3"` or `3`. */
export function parseVersionHeader(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

const etag = (version: number) => `"${version}"`;

export async function menuRoutes(app: FastifyInstance, opts: { store: PublishStore }) {
  const { db, config } = app.deps;
  const viewer = requireRole('viewer');
  const editor = requireRole('editor');
  const owner = requireRole('owner');

  async function loadMenu(id: string): Promise<MenuRow | undefined> {
    const [row] = await db.query<MenuRow>(`${SELECT_FULL} WHERE m.id = $1`, [id]);
    return row;
  }

  app.get('/api/menus', { preHandler: viewer }, async () => {
    const rows = await db.query<SummaryRow>(
      `SELECT m.id, m.slug, m.draft_version, m.updated_at, u.name AS updated_by_name, p.public_slug,
              m.draft->'title'->>(m.draft->>'defaultLocale') AS title
       FROM menus m LEFT JOIN users u ON u.id = m.updated_by LEFT JOIN publications p ON p.menu_id = m.id
       ORDER BY m.updated_at DESC`,
    );
    return { menus: rows.map((r) => summary(r, config.PUBLIC_URL)) };
  });

  app.post(
    '/api/menus',
    { preHandler: editor, bodyLimit: MENU_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ menu: z.unknown(), slug: slugSchema.optional() }).strict().safeParse(req.body);
      if (!body.success) throw badRequest();
      const draft = parseDraft(body.data.menu);

      const [count] = await db.query<{ n: string }>('SELECT count(*) AS n FROM menus');
      if (Number(count?.n ?? 0) >= MAX_MENUS) throw conflict('too_many_menus');

      // A concurrent create can grab the same slug between the check and the insert: retry a few times.
      for (let attempt = 0; attempt < 5; attempt++) {
        const slug = body.data.slug ?? (await uniqueSlug(db, slugFromMenu(draft)));
        try {
          const [created] = await db.query<{ id: string }>(
            'INSERT INTO menus (slug, draft, updated_by) VALUES ($1, $2, $3) RETURNING id',
            [slug, JSON.stringify(draft), req.user!.id],
          );
          await audit(db, { userId: req.user!.id, action: 'menu.create', targetType: 'menu', targetId: created!.id });
          const row = (await loadMenu(created!.id))!;
          return reply.status(201).header('etag', etag(row.draft_version)).send({ menu: full(row) });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          if (body.data.slug) throw conflict('slug_taken');
        }
      }
      throw conflict('slug_taken');
    },
  );

  app.get('/api/menus/:id', { preHandler: viewer }, async (req, reply) => {
    const id = parseId(req);
    const [meta] = await db.query<{ draft_version: number }>('SELECT draft_version FROM menus WHERE id = $1', [id]);
    if (!meta) throw notFound();
    reply.header('etag', etag(meta.draft_version));
    // Cheap "anything new?" check from other devices: no body when the client already has this version.
    if (parseVersionHeader(req.headers['if-none-match']) === meta.draft_version) return reply.status(304).send();
    const row = await loadMenu(id);
    if (!row) throw notFound();
    return reply.header('etag', etag(row.draft_version)).send({ menu: full(row) });
  });

  app.put(
    '/api/menus/:id',
    { preHandler: editor, bodyLimit: MENU_BODY_LIMIT, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = parseId(req);
      const expected = parseVersionHeader(req.headers['if-match']);
      if (expected === null) throw new HttpError(428, 'precondition_required');
      const draft = parseDraft(req.body);

      // Optimistic lock: the update only applies to the version the client last saw. RETURNING (not a
      // re-read) so a save that lands right after ours can't be reported back as ours.
      const [updated] = await db.query<{ id: string; slug: string; draft_version: number; updated_at: Date }>(
        `UPDATE menus SET draft = $3, draft_version = draft_version + 1, updated_by = $4, updated_at = now()
         WHERE id = $1 AND draft_version = $2
         RETURNING id, slug, draft_version, updated_at`,
        [id, expected, JSON.stringify(draft), req.user!.id],
      );
      if (updated) {
        return reply.header('etag', etag(updated.draft_version)).send({
          menu: { id: updated.id, slug: updated.slug, draftVersion: updated.draft_version, updatedAt: updated.updated_at, updatedBy: req.user!.name },
        });
      }
      const row = await loadMenu(id);
      if (!row) throw notFound();
      return reply.status(409).header('etag', etag(row.draft_version)).send({
        error: 'version_conflict',
        draftVersion: row.draft_version,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by_name,
      });
    },
  );

  app.delete('/api/menus/:id', { preHandler: owner }, async (req, reply) => {
    const id = parseId(req);
    const publicSlug = await db.transaction(async (tx) => {
      // Lock the menu first: a publish in progress holds this lock, so we wait for it and then see its
      // publication row (otherwise a concurrent publish could leave a deleted menu online).
      const [locked] = await tx.query('SELECT 1 FROM menus WHERE id = $1 FOR UPDATE', [id]);
      if (!locked) throw notFound();
      const [pub] = await tx.query<{ public_slug: string }>('SELECT public_slug FROM publications WHERE menu_id = $1', [id]);
      const [row] = await tx.query<{ slug: string }>('DELETE FROM menus WHERE id = $1 RETURNING slug', [id]);
      await audit(tx, { userId: req.user!.id, action: 'menu.delete', targetType: 'menu', targetId: id, meta: { slug: row!.slug } });
      return pub?.public_slug ?? null;
    });
    // After COMMIT: if the transaction had failed, the menu (and its page) would correctly still exist.
    if (publicSlug) await opts.store.remove(publicSlug);
    return reply.status(204).send();
  });
}
