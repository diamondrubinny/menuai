/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { runtimeScript } from '../../../src/core/exportHtml';
import { parseMenu } from '../../../src/core/schema';
import type { SqlClient } from '../db/sql';
import { renderPublishedMenu } from './render';
import type { PublishStore } from './store';

/**
 * Re-renders published pages that were written by an older version of MenuAI. The page's CSP pins the
 * *current* runtime script by its hash, so an old page's script would otherwise be blocked after an
 * update (language switching and the menu's interactions would stop working). Each page is rendered
 * again from the version that is live: same content, current renderer. Pages already up to date are
 * left alone. Runs before the server accepts requests.
 */
export async function refreshPublishedPages(db: SqlClient, store: PublishStore): Promise<{ refreshed: number; failed: number }> {
  const current = Buffer.from(`<script>${runtimeScript()}</script>`);
  const rows = await db.query<{ public_slug: string; data: unknown }>(
    'SELECT p.public_slug, v.data FROM publications p JOIN menu_versions v ON v.id = p.version_id',
  );
  let refreshed = 0;
  let failed = 0;
  for (const row of rows) {
    const file = await store.read(row.public_slug);
    if (file && file.html.includes(current)) continue;
    const parsed = parseMenu(row.data);
    if (!parsed.ok) {
      failed++;
      continue;
    }
    try {
      await store.write(row.public_slug, await renderPublishedMenu(parsed.menu));
      refreshed++;
    } catch {
      failed++;
    }
  }
  return { refreshed, failed };
}
