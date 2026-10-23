/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Uploads to the MenuAI server: the server scans each image for malware and re-encodes it to WebP. */

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: 'rejected' | 'invalid' | 'unavailable' | 'full' | 'failed' };

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Turns a data URL produced by the editor back into a typed binary body. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const binary = atob(m[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function uploadImage(image: Blob): Promise<UploadResult> {
  let res: Response;
  try {
    res = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': image.type },
      body: image,
    });
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  const json = (await res.json().catch(() => null)) as { upload?: { url?: string }; error?: string } | null;
  if (res.ok && typeof json?.upload?.url === 'string') return { ok: true, url: json.upload.url };
  if (res.status === 422) return { ok: false, error: json?.error === 'rejected' ? 'rejected' : 'invalid' };
  if (res.status === 415) return { ok: false, error: 'invalid' };
  if (res.status === 507) return { ok: false, error: 'full' };
  if (res.status === 503 || res.status === 0) return { ok: false, error: 'unavailable' };
  return { ok: false, error: 'failed' };
}
