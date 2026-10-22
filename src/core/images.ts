/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { IMAGE_SRC_RE, LIMITS } from './schema';

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1400;

export type ImageError = 'type' | 'size' | 'decode' | 'tooLarge';

export class ImageProcessError extends Error {
  constructor(public readonly code: ImageError) {
    super(code);
  }
}

/** Checks magic bytes, so a renamed file (e.g. SVG/HTML saved as .png) is rejected. */
export async function sniffImageType(file: Blob): Promise<(typeof ALLOWED_IMAGE_TYPES)[number] | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const is = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
  if (is([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (is([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/**
 * Validates an uploaded image and re-encodes it through a canvas.
 * Re-encoding strips EXIF (e.g. GPS location) and any embedded payload, and downsizes large photos.
 */
export async function processImageFile(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageProcessError('size');
  const sniffed = await sniffImageType(file);
  if (!sniffed || !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type || sniffed)) {
    throw new ImageProcessError('type');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageProcessError('decode');
  }
  const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageProcessError('decode');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let dataUrl = canvas.toDataURL('image/webp', 0.82);
  // Safari < 16 cannot encode WebP and silently returns PNG; prefer a smaller JPEG then.
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  if (dataUrl.length > LIMITS.imageDataUrl) throw new ImageProcessError('tooLarge');
  if (!IMAGE_SRC_RE.test(dataUrl)) throw new ImageProcessError('decode');
  return dataUrl;
}

/** Accepts only https URLs that pass the schema's pattern. */
export function normalizeImageUrl(input: string): string | null {
  const value = input.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return IMAGE_SRC_RE.test(value) ? value : null;
}
