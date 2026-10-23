/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { statfs } from 'node:fs/promises';
import type { Config } from '../config';
import type { SqlClient } from '../db/sql';
import { clamdPing } from '../uploads/clamd';

export interface StatusCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Disk space below this (MB) is reported as a problem: uploads and publishing would start failing. */
export const MIN_FREE_MB = 1024;

async function freeMb(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Math.floor((s.bavail * s.bsize) / 1024 / 1024);
  } catch {
    return null;
  }
}

/** Health of everything the server depends on; for `cli.mjs status`, cron and monitoring. */
export async function collectStatus(db: SqlClient, config: Config): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];
  try {
    const [row] = await db.query<{ menus: string; users: string; images: string; published: string; version: string }>(
      `SELECT (SELECT count(*) FROM menus) AS menus,
              (SELECT count(*) FROM users WHERE disabled_at IS NULL) AS users,
              (SELECT count(*) FROM uploads WHERE status = 'clean') AS images,
              (SELECT count(*) FROM publications) AS published,
              current_setting('server_version') AS version`,
    );
    checks.push({
      name: 'database',
      ok: true,
      detail: `PostgreSQL ${row!.version} · ${row!.menus} menus (${row!.published} published) · ${row!.users} active users · ${row!.images} images`,
    });
  } catch (err) {
    checks.push({ name: 'database', ok: false, detail: err instanceof Error ? err.message : 'unreachable' });
  }

  if (config.CLAMAV_URL) {
    const ok = await clamdPing(config.CLAMAV_URL);
    checks.push({ name: 'virus scanner', ok, detail: ok ? 'clamd answers' : `clamd at ${config.CLAMAV_URL} does not answer: uploads are refused` });
  } else {
    checks.push({ name: 'virus scanner', ok: config.UPLOADS_ALLOW_UNSCANNED || config.NODE_ENV !== 'production', detail: 'CLAMAV_URL not set: image uploads are disabled' });
  }

  for (const [name, dir] of [['publish storage', config.PUBLISH_DIR], ['upload storage', config.UPLOAD_DIR]] as const) {
    const mb = await freeMb(dir);
    checks.push(
      mb === null
        ? { name, ok: false, detail: `${dir} is not accessible` }
        : { name, ok: mb >= MIN_FREE_MB, detail: `${dir}: ${mb} MB free${mb < MIN_FREE_MB ? ` (below ${MIN_FREE_MB} MB)` : ''}` },
    );
  }
  return checks;
}
