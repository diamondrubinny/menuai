/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { SqlClient } from '../db/sql';
import type { MediaStore } from './store';

/** Orphans (referenced by no draft and no published version) are kept this long before cleanup. */
export const ORPHAN_GRACE_HOURS = 24;

/**
 * Deletes clean uploads that no menu draft or stored version references any more.
 * Returns the number of images removed.
 */
export async function collectOrphanUploads(db: SqlClient, media: MediaStore, graceHours = ORPHAN_GRACE_HOURS): Promise<number> {
  // Every referenced image id, extracted in one pass over drafts and stored versions (linear in total size,
  // instead of re-reading every menu for every image).
  const orphans = await db.query<{ id: string }>(
    `WITH referenced AS (
       SELECT DISTINCT (regexp_matches(doc, '/media/([0-9a-f-]{36})\\.webp', 'g'))[1] AS id
       FROM (SELECT draft::text AS doc FROM menus UNION ALL SELECT data::text FROM menu_versions) docs
     )
     SELECT u.id FROM uploads u
     WHERE u.status = 'clean' AND u.created_at < now() - make_interval(hours => $1)
       AND u.id::text NOT IN (SELECT id FROM referenced WHERE id IS NOT NULL)`,
    [graceHours],
  );
  for (const { id } of orphans) {
    await media.remove(id);
    await db.query('DELETE FROM uploads WHERE id = $1', [id]);
  }
  return orphans.length;
}
