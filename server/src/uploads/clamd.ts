/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { connect } from 'node:net';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** The scanner could not give an answer (down, timeout, size limit, protocol error): the upload must not pass. */
export class ScannerUnavailableError extends Error {}

export interface Scanner {
  scan(data: Buffer): Promise<ScanResult>;
}

const CHUNK = 64 * 1024;

/**
 * Minimal clamd client using the documented INSTREAM command: the file is streamed to the local
 * clamd over TCP in length-prefixed chunks; nothing leaves the server.
 */
export function clamdScanner(url: string, timeoutMs = 30_000): Scanner {
  const { hostname, port } = new URL(url);
  return {
    scan(data) {
      return new Promise<ScanResult>((resolve, reject) => {
        const socket = connect({ host: hostname, port: Number(port) });
        const chunks: Buffer[] = [];
        let settled = false;
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          reject(new ScannerUnavailableError(message));
        };
        socket.setTimeout(timeoutMs, () => fail('clamd timeout'));
        socket.on('error', (err) => fail(`clamd: ${err.message}`));
        socket.on('data', (d: Buffer) => chunks.push(d));
        socket.on('end', () => {
          if (settled) return;
          settled = true;
          const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
          // "stream: OK" | "stream: <Signature> FOUND" | "INSTREAM size limit exceeded. ERROR" | "... ERROR"
          if (/^stream: OK$/.test(reply)) return resolve({ clean: true });
          const found = /^stream: (.+) FOUND$/.exec(reply);
          if (found) return resolve({ clean: false, signature: found[1]!.slice(0, 200) });
          reject(new ScannerUnavailableError(`clamd: unexpected reply "${reply.slice(0, 120)}"`));
        });
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          for (let i = 0; i < data.length; i += CHUNK) {
            const part = data.subarray(i, i + CHUNK);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.length);
            socket.write(size);
            socket.write(part);
          }
          socket.end(Buffer.alloc(4)); // zero-length chunk = end of stream
        });
      });
    },
  };
}

/** Development only (UPLOADS_ALLOW_UNSCANNED): accepts everything. Never used in production (config refuses it). */
export const unscanned: Scanner = { scan: async () => ({ clean: true }) };
