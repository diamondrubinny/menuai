/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { z } from 'zod';
import { LOCALE_CODE_RE } from './locales';

export const SCHEMA_VERSION = 1 as const;

export const LIMITS = {
  text: 200,
  longText: 1200,
  sections: 60,
  itemsPerSection: 200,
  variants: 8,
  locales: 30,
  /** Max size of an image data URL (after re-encoding) in characters. */
  imageDataUrl: 3_000_000,
  importBytes: 10 * 1024 * 1024,
} as const;

const localeCode = z.string().regex(LOCALE_CODE_RE);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** A text in several languages: { he: "...", en: "..." } */
export const localizedSchema = z.record(localeCode, z.string().max(LIMITS.longText));
export type Localized = z.infer<typeof localizedSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Only https URLs or re-encoded raster data URLs are accepted.
 * SVG / HTML / javascript: URLs are rejected to prevent script injection.
 */
export const IMAGE_SRC_RE = /^(https:\/\/[^\s"'<>()]+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;

export const imageRefSchema = z.object({
  src: z.string().max(LIMITS.imageDataUrl).regex(IMAGE_SRC_RE),
  alt: localizedSchema.default({}),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

export const TAGS = ['vegan', 'vegetarian', 'glutenFree', 'new', 'chefPick', 'popular', 'kosher', 'halal'] as const;
export type Tag = (typeof TAGS)[number];

/** The 14 allergens of EU Regulation 1169/2011 (Annex II). */
export const ALLERGENS = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const variantSchema = z.object({
  id,
  label: localizedSchema.default({}),
  price: z.number().min(0).max(1_000_000),
});
export type Variant = z.infer<typeof variantSchema>;

export const itemSchema = z.object({
  id,
  name: localizedSchema.default({}),
  description: localizedSchema.default({}),
  price: z.number().min(0).max(1_000_000).optional(),
  variants: z.array(variantSchema).max(LIMITS.variants).default([]),
  image: imageRefSchema.optional(),
  tags: z.array(z.enum(TAGS)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  spicy: z.number().int().min(0).max(3).default(0),
  calories: z.number().int().min(0).max(20_000).optional(),
  soldOut: z.boolean().default(false),
  hidden: z.boolean().default(false),
});
export type Item = z.infer<typeof itemSchema>;

export const sectionSchema = z.object({
  id,
  title: localizedSchema.default({}),
  description: localizedSchema.default({}),
  items: z.array(itemSchema).max(LIMITS.itemsPerSection).default([]),
  image: imageRefSchema.optional(),
  hidden: z.boolean().default(false),
});
export type Section = z.infer<typeof sectionSchema>;

export const THEME_IDS = [
  'noir-gold', 'ivory-bistro', 'chalkboard', 'neon-night', 'aurora-glass', 'nordic-minimal',
  'terracotta', 'matcha-zen', 'ocean-breeze', 'desert-souk', 'retro-diner', 'garden-brunch',
  'emerald-deco', 'botanical', 'brutalist', 'sunset',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const LAYOUTS = ['list', 'cards', 'magazine', 'showcase'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const FONT_IDS = [
  'heebo', 'rubik', 'frank-ruhl-libre', 'suez-one', 'secular-one', 'amatic-sc',
  'playfair-display', 'cormorant-garamond', 'cairo', 'amiri', 'bebas-neue', 'inter',
] as const;
export type FontId = (typeof FONT_IDS)[number];

export const EFFECTS = [
  'reveal', 'glass', 'glow', 'aurora', 'grain', 'tilt', 'shimmer', 'parallax', 'leaders', 'ornaments',
  'spotlight', 'bokeh', 'gradientBorder', 'kenBurns',
] as const;
export type Effect = (typeof EFFECTS)[number];

export const HERO_STYLES = ['classic', 'overlay', 'split'] as const;
export type HeroStyle = (typeof HERO_STYLES)[number];

export const MODES = ['original', 'alt'] as const;
export type Mode = (typeof MODES)[number];

export const PATTERNS = ['none', 'dots', 'grid', 'waves', 'terrazzo', 'arabesque', 'stripes'] as const;
export type Pattern = (typeof PATTERNS)[number];

export const PALETTE_KEYS = ['bg', 'surface', 'text', 'muted', 'accent', 'accent2'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const designSchema = z.object({
  theme: z.enum(THEME_IDS).default('noir-gold'),
  layout: z.enum(LAYOUTS).default('list'),
  heroStyle: z.enum(HERO_STYLES).optional(),
  pattern: z.enum(PATTERNS).optional(),
  mode: z.enum(MODES).optional(),
  palette: z.partialRecord(z.enum(PALETTE_KEYS), hexColor).default({}),
  fontDisplay: z.enum(FONT_IDS).optional(),
  fontBody: z.enum(FONT_IDS).optional(),
  radius: z.number().min(0).max(32).optional(),
  density: z.enum(['compact', 'cozy', 'airy']).default('cozy'),
  scale: z.number().min(0.85).max(1.3).default(1),
  effects: z.partialRecord(z.enum(EFFECTS), z.boolean()).default({}),
  showImages: z.boolean().default(true),
  showAllergens: z.boolean().default(true),
  showLanguageSwitcher: z.boolean().default(true),
  stickyNav: z.boolean().default(true),
});
export type Design = z.infer<typeof designSchema>;

export const LABEL_KEYS = [
  'soldOut', 'spicy', 'allergens', 'contains', 'calories', 'language', 'sections', 'reduceMotion', 'from',
  ...TAGS,
  ...ALLERGENS,
] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];

export const menuSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  defaultLocale: localeCode,
  locales: z.array(localeCode).min(1).max(LIMITS.locales),
  currency: z.string().regex(/^[A-Z]{3}$/).default('ILS'),
  title: localizedSchema.default({}),
  subtitle: localizedSchema.default({}),
  footerNote: localizedSchema.default({}),
  logo: imageRefSchema.optional(),
  hero: imageRefSchema.optional(),
  sections: z.array(sectionSchema).max(LIMITS.sections).default([]),
  design: designSchema.default(designSchema.parse({})),
  labels: z.record(localeCode, z.partialRecord(z.enum(LABEL_KEYS), z.string().max(LIMITS.text))).default({}),
  updatedAt: z.string().max(40).default(() => new Date().toISOString()),
}).refine((m) => m.locales.includes(m.defaultLocale), {
  message: 'defaultLocale must be one of locales',
  path: ['defaultLocale'],
});
export type Menu = z.infer<typeof menuSchema>;

export type ParseResult = { ok: true; menu: Menu } | { ok: false; error: string };

/** Validates untrusted input (imports, storage). Never throws. */
export function parseMenu(input: unknown): ParseResult {
  const result = menuSchema.safeParse(input);
  if (result.success) return { ok: true, menu: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: first ? `${first.path.join('.') || 'menu'}: ${first.message}` : 'Invalid menu' };
}

/** Parses JSON text with a size limit. Never throws. */
export function parseMenuJson(text: string): ParseResult {
  if (text.length > LIMITS.importBytes) return { ok: false, error: 'File is too large' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a valid JSON file' };
  }
  return parseMenu(data);
}
