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
  const orphans = await db.query<{ id: string }>(
    `SELECT u.id FROM uploads u
     WHERE u.status = 'clean' AND u.created_at < now() - make_interval(hours => $1)
       AND NOT EXISTS (SELECT 1 FROM menus m WHERE strpos(m.draft::text, u.id::text) > 0)
       AND NOT EXISTS (SELECT 1 FROM menu_versions v WHERE strpos(v.data::text, u.id::text) > 0)`,
    [graceHours],
  );
  for (const { id } of orphans) {
    await media.remove(id);
    await db.query('DELETE FROM uploads WHERE id = $1', [id]);
  }
  return orphans.length;
}
