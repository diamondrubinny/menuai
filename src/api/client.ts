/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Minimal client for the optional MenuAI server (Phase 2). The editor works without it. */

export type ApiResult<T> =
  | { ok: true; status: number; data: T; etag: string | null }
  | { ok: false; status: number; error: string; body?: Record<string, unknown> };

export interface ApiInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** JSON request to `/api`. Never throws: network failures come back as `{ ok: false, status: 0 }`. 304 is a success with `data: null`. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  const etag = res.headers.get('etag');
  if (res.status === 304) return { ok: true, status: 304, data: null as T, etag };
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  // A static host answers unknown paths with index.html (200): that is "no server", not a success.
  if (res.ok && json === null && res.status !== 204) return { ok: false, status: res.status, error: 'not_json' };
  if (!res.ok) {
    return { ok: false, status: res.status, error: json?.error ?? 'unknown', ...(json ? { body: json as Record<string, unknown> } : {}) };
  }
  return { ok: true, status: res.status, data: json as T, etag };
}

/** True when the response means "no MenuAI server here" (static hosting, server down, proxy error page). */
export function isNoServer(status: number, error: string): boolean {
  return error === 'not_json' || status === 0 || status === 404 || status === 502 || status === 503 || (status >= 500 && error === 'unknown');
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}
