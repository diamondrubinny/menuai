/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import sharp from 'sharp';

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1600;
/** Refuse "pixel bombs": small files that decode to huge bitmaps. */
const MAX_INPUT_PIXELS = 40_000_000;

// One image at a time: decoding is memory hungry, and uploads are rare.
sharp.concurrency(1);
sharp.cache(false);

/** The real type from the file's magic bytes (never trust the extension or the declared type alone). */
export function sniffImage(data: Buffer): UploadType | null {
  const is = (bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);
  if (is([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (is([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (is([0x52, 0x49, 0x46, 0x46]) && is([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export class ImageDecodeError extends Error {}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Re-encodes a (scanned) image to WebP: applies the EXIF orientation, downsizes, and drops every piece of
 * metadata (EXIF/GPS, ICC, XMP) and anything else hidden in the original file.
 */
export function processImage(data: Buffer): Promise<{ webp: Buffer; width: number; height: number }> {
  const run = async () => {
    try {
      const { data: webp, info } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      return { webp, width: info.width, height: info.height };
    } catch (err) {
      throw new ImageDecodeError(err instanceof Error ? err.message : 'decode failed');
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
