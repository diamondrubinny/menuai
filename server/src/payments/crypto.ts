/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Provider credentials are encrypted at rest with AES-256-GCM under PAYMENTS_KEY (from the environment,
 * never in the database or backups). Format: `v1.<iv>.<tag>.<ciphertext>`, base64url parts.
 * A database dump alone therefore does not reveal the restaurant's payment account keys.
 */
const VERSION = 'v1';
/** Binds the ciphertext to its purpose, so it can't be swapped into another encrypted field. */
const AAD = Buffer.from('menuai:payment-credentials');

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('PAYMENTS_KEY must be 32 bytes');
  return key;
}

export function seal(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(base64Key), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** Throws if the value was tampered with or sealed under another key. */
export function open(sealed: string, base64Key: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('unknown credentials format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), Buffer.from(iv, 'base64url'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
