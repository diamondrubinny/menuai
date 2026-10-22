/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { Localized } from './schema';

/** Text for `locale`, falling back to the default locale and then to any non-empty value. */
export function t(value: Localized | undefined, locale: string, fallbackLocale: string): string {
  if (!value) return '';
  const direct = value[locale]?.trim();
  if (direct) return direct;
  const fallback = value[fallbackLocale]?.trim();
  if (fallback) return fallback;
  return Object.values(value).find((v) => v.trim())?.trim() ?? '';
}

/** True when `locale` has its own (non-fallback) text. */
export function hasTranslation(value: Localized | undefined, locale: string): boolean {
  return Boolean(value?.[locale]?.trim());
}
