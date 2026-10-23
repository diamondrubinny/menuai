/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const PUBLIC_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Published menus as static files: `<dir>/<slug>.html`. */
export interface PublishStore {
  write(slug: string, html: string): Promise<void>;
  /** The file and a validator that changes on every publish (for cheap `304 Not Modified`). */
  read(slug: string): Promise<{ html: Buffer; etag: string } | null>;
  remove(slug: string): Promise<void>;
}

export function createFileStore(dir: string): PublishStore {
  // The slug is checked before it ever touches a path, so nothing can escape `dir`.
  const fileFor = (slug: string) => {
    if (!PUBLIC_SLUG_RE.test(slug)) throw new Error('invalid slug');
    return path.join(dir, `${slug}.html`);
  };
  return {
    async write(slug, html) {
      const target = fileFor(slug);
      await mkdir(dir, { recursive: true });
      // Atomic replace: guests never see a half-written file.
      const tmp = path.join(dir, `.${slug}.${randomBytes(6).toString('hex')}.tmp`);
      await writeFile(tmp, html, { encoding: 'utf8', mode: 0o644 });
      try {
        await rename(tmp, target);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },
    async read(slug) {
      if (!PUBLIC_SLUG_RE.test(slug)) return null;
      try {
        const file = await open(fileFor(slug), 'r');
        try {
          const [stat, html] = await Promise.all([file.stat(), file.readFile()]);
          // Every publish is a new file (atomic rename), so the inode changes even within the same millisecond.
          return { html, etag: `W/"${stat.ino.toString(36)}-${stat.size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}"` };
        } finally {
          await file.close();
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(slug) {
      await rm(fileFor(slug), { force: true });
    },
  };
}
