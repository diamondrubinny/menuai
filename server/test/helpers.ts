/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { Writable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createPgliteClient } from '../src/db/pglite';
import { migrate } from '../src/db/migrate';
import type { SqlClient } from '../src/db/sql';
import type { Mail, Mailer } from '../src/mail/mailer';
import type { PublishStore } from '../src/publish/store';
import type { Scanner } from '../src/uploads/clamd';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused/test',
    PUBLIC_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    // Each test app publishes into its own throwaway directory.
    PUBLISH_DIR: mkdtempSync(path.join(tmpdir(), 'menuai-pub-')),
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'menuai-up-')),
    ...overrides,
  });
}

export async function testDb(): Promise<SqlClient> {
  const db = await createPgliteClient();
  await migrate(db);
  return db;
}

/** Captures outgoing email instead of sending it. */
export function captureMailer(configured = true): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { configured, sent, send: async (m) => { sent.push(m); } };
}

export const ORIGIN = 'http://localhost:5173';

export async function testApp(opts: { config?: Record<string, string>; db?: SqlClient; logs?: string[]; mailer?: Mailer; publishStore?: PublishStore; scanner?: Scanner | null; paymentHttp?: typeof fetch } = {}) {
  const db = opts.db ?? (await testDb());
  const config = testConfig(opts.config);
  const logs = opts.logs;
  const app = await buildApp({
    config: logs ? { ...config, LOG_LEVEL: 'info' } : config,
    db,
    mailer: opts.mailer ?? captureMailer(),
    publishStore: opts.publishStore,
    scanner: opts.scanner,
    paymentHttp: opts.paymentHttp,
    logStream: logs ? new Writable({ write(chunk, _enc, cb) { logs.push(String(chunk)); cb(); } }) : undefined,
  });
  return { app, db, config, mailer: opts.mailer };
}
