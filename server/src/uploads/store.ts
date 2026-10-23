/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Uploaded files: `quarantine/<id>` until scanned and processed, then `public/<id>.webp`. */
export interface MediaStore {
  quarantine(id: string, data: Buffer): Promise<void>;
  dropQuarantine(id: string): Promise<void>;
  publish(id: string, webp: Buffer): Promise<void>;
  read(id: string): Promise<Buffer | null>;
  remove(id: string): Promise<void>;
}

export function createMediaStore(dir: string): MediaStore {
  const quarantineDir = path.join(dir, 'quarantine');
  const publicDir = path.join(dir, 'public');
  // Ids are server-generated UUIDs, but are still checked before touching a path.
  const check = (id: string) => {
    if (!ID_RE.test(id)) throw new Error('invalid id');
    return id;
  };
  return {
    async quarantine(id, data) {
      await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(quarantineDir, check(id)), data, { mode: 0o600 });
    },
    async dropQuarantine(id) {
      await rm(path.join(quarantineDir, check(id)), { force: true });
    },
    async publish(id, webp) {
      await mkdir(publicDir, { recursive: true });
      const target = path.join(publicDir, `${check(id)}.webp`);
      const tmp = path.join(publicDir, `.${id}.${randomBytes(6).toString('hex')}.tmp`);
      await writeFile(tmp, webp, { mode: 0o644 });
      await rename(tmp, target);
    },
    async read(id) {
      if (!ID_RE.test(id)) return null;
      try {
        const file = await open(path.join(publicDir, `${id}.webp`), 'r');
        try {
          return await file.readFile();
        } finally {
          await file.close();
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(id) {
      await rm(path.join(publicDir, `${check(id)}.webp`), { force: true });
      await rm(path.join(quarantineDir, id), { force: true });
    },
  };
}
