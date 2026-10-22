import { HERO_STYLES, PATTERNS, THEME_IDS } from './schema';
import { ensureContrast, hexToHsl, isDark, mix } from './color';
import type { Design, Effect, FontId, HeroStyle, Layout, Mode, PaletteKey, Pattern, ThemeId } from './schema';

export type Palette = Record<PaletteKey, string>;
export type Surface = 'flat' | 'card' | 'glass' | 'outline';
export type Texture = 'none' | 'paper' | 'chalk' | 'linen';
export type Ornament = 'none' | 'art-deco' | 'flourish' | 'geometric' | 'dots';

export interface Theme {
  id: ThemeId;
  name: { he: string; en: string; ar: string };
  palette: Palette;
  fontDisplay: FontId;
  fontBody: FontId;
  displayWeight: 400 | 700;
  headingCase: 'none' | 'uppercase';
  layout: Layout;
  radius: number;
  surface: Surface;
  texture: Texture;
  ornament: Ornament;
  heroStyle?: HeroStyle;
  pattern?: Pattern;
  effects: Partial<Record<Effect, boolean>>;
}

export const THEMES: Record<ThemeId, Theme> = {
  'noir-gold': {
    id: 'noir-gold',
    name: { he: 'נואר וזהב', en: 'Noir & Gold', ar: 'أسود وذهبي' },
    palette: { bg: '#0e0d0b', surface: '#1a1815', text: '#f4ede1', muted: '#bcb09b', accent: '#d9b56f', accent2: '#8a6d3b' },
    fontDisplay: 'playfair-display', fontBody: 'heebo', displayWeight: 700, headingCase: 'uppercase',
    layout: 'list', radius: 2, surface: 'flat', texture: 'none', ornament: 'art-deco', heroStyle: 'overlay',
    effects: { leaders: true, ornaments: true, reveal: true, shimmer: true, grain: true, spotlight: true },
  },
  'ivory-bistro': {
    id: 'ivory-bistro',
    name: { he: 'ביסטרו שנהב', en: 'Ivory Bistro', ar: 'بيسترو عاجي' },
    palette: { bg: '#f6efe2', surface: '#fffaf0', text: '#2a2118', muted: '#62523f', accent: '#8c2f1b', accent2: '#c9a66b' },
    fontDisplay: 'cormorant-garamond', fontBody: 'frank-ruhl-libre', displayWeight: 700, headingCase: 'none',
    layout: 'list', radius: 0, surface: 'flat', texture: 'paper', ornament: 'flourish',
    effects: { leaders: true, ornaments: true, reveal: true },
  },
  chalkboard: {
    id: 'chalkboard',
    name: { he: 'לוח גיר', en: 'Chalkboard', ar: 'سبورة طباشير' },
    palette: { bg: '#1f2a27', surface: '#27342f', text: '#f1efe6', muted: '#c4cbc3', accent: '#f2c94c', accent2: '#9ad1c0' },
    fontDisplay: 'amatic-sc', fontBody: 'heebo', displayWeight: 700, headingCase: 'none',
    layout: 'magazine', radius: 6, surface: 'flat', texture: 'chalk', ornament: 'dots',
    effects: { reveal: true, grain: true, leaders: true },
  },
  'neon-night': {
    id: 'neon-night',
    name: { he: 'לילה ניאון', en: 'Neon Night', ar: 'ليلة النيون' },
    palette: { bg: '#0b0618', surface: '#160e2c', text: '#f5f0ff', muted: '#bcaee0', accent: '#ff5bdc', accent2: '#38e8ff' },
    fontDisplay: 'secular-one', fontBody: 'rubik', displayWeight: 400, headingCase: 'uppercase',
    layout: 'cards', radius: 14, surface: 'outline', texture: 'none', ornament: 'none', pattern: 'grid',
    effects: { glow: true, tilt: true, reveal: true, aurora: true, spotlight: true },
  },
  'aurora-glass': {
    id: 'aurora-glass',
    name: { he: 'זכוכית זוהרת', en: 'Aurora Glass', ar: 'زجاج الشفق' },
    palette: { bg: '#0f172a', surface: '#1e293b', text: '#f8fafc', muted: '#cbd5e1', accent: '#7dd3fc', accent2: '#c084fc' },
    fontDisplay: 'rubik', fontBody: 'rubik', displayWeight: 700, headingCase: 'none',
    layout: 'cards', radius: 22, surface: 'glass', texture: 'none', ornament: 'none',
    effects: { aurora: true, glass: true, tilt: true, reveal: true, parallax: true, gradientBorder: true, bokeh: true },
  },
  'nordic-minimal': {
    id: 'nordic-minimal',
    name: { he: 'מינימל נורדי', en: 'Nordic Minimal', ar: 'بساطة إسكندنافية' },
    palette: { bg: '#fafaf7', surface: '#ffffff', text: '#111111', muted: '#555555', accent: '#111111', accent2: '#c8b89a' },
    fontDisplay: 'heebo', fontBody: 'heebo', displayWeight: 700, headingCase: 'none',
    layout: 'list', radius: 0, surface: 'flat', texture: 'none', ornament: 'none',
    effects: { reveal: true },
  },
  terracotta: {
    id: 'terracotta',
    name: { he: 'טרקוטה ים־תיכונית', en: 'Mediterranean Terracotta', ar: 'تيراكوتا متوسطية' },
    palette: { bg: '#f3e6d8', surface: '#fbf3ea', text: '#3b2418', muted: '#684a39', accent: '#9c3f27', accent2: '#5f7a4f' },
    fontDisplay: 'suez-one', fontBody: 'rubik', displayWeight: 400, headingCase: 'none',
    layout: 'magazine', radius: 10, surface: 'card', texture: 'linen', ornament: 'geometric', pattern: 'terrazzo',
    effects: { reveal: true, ornaments: true, leaders: true },
  },
  'matcha-zen': {
    id: 'matcha-zen',
    name: { he: 'מאצ׳ה זן', en: 'Matcha Zen', ar: 'ماتشا زِن' },
    palette: { bg: '#eef0e6', surface: '#f8f9f3', text: '#1f2a1c', muted: '#4b5945', accent: '#46652c', accent2: '#b0412e' },
    fontDisplay: 'cormorant-garamond', fontBody: 'heebo', displayWeight: 700, headingCase: 'none',
    layout: 'showcase', radius: 4, surface: 'card', texture: 'paper', ornament: 'dots', heroStyle: 'split',
    effects: { reveal: true, ornaments: true, parallax: true, kenBurns: true },
  },
  'ocean-breeze': {
    id: 'ocean-breeze',
    name: { he: 'בריזה ימית', en: 'Ocean Breeze', ar: 'نسيم البحر' },
    palette: { bg: '#e8f4f8', surface: '#ffffff', text: '#0b2a3a', muted: '#3a5868', accent: '#0a668e', accent2: '#f59e0b' },
    fontDisplay: 'secular-one', fontBody: 'rubik', displayWeight: 400, headingCase: 'none',
    layout: 'cards', radius: 20, surface: 'card', texture: 'none', ornament: 'none', pattern: 'waves', heroStyle: 'overlay',
    effects: { reveal: true, tilt: true, parallax: true, kenBurns: true },
  },
  'desert-souk': {
    id: 'desert-souk',
    name: { he: 'שוק המדבר', en: 'Desert Souk', ar: 'سوق الصحراء' },
    palette: { bg: '#1b1430', surface: '#251b40', text: '#fbf3e4', muted: '#d6c7a8', accent: '#e8b04b', accent2: '#c2410c' },
    fontDisplay: 'amiri', fontBody: 'cairo', displayWeight: 700, headingCase: 'none',
    layout: 'list', radius: 8, surface: 'flat', texture: 'none', ornament: 'geometric',
    effects: { shimmer: true, reveal: true, grain: true, ornaments: true, leaders: true },
  },
  'retro-diner': {
    id: 'retro-diner',
    name: { he: 'דיינר רטרו', en: 'Retro Diner', ar: 'مطعم ريترو' },
    palette: { bg: '#fdf4e3', surface: '#ffffff', text: '#1c1c1c', muted: '#4a4a4a', accent: '#b80f2a', accent2: '#00877a' },
    fontDisplay: 'secular-one', fontBody: 'rubik', displayWeight: 400, headingCase: 'uppercase',
    layout: 'cards', radius: 14, surface: 'card', texture: 'none', ornament: 'dots', pattern: 'stripes',
    effects: { reveal: true, tilt: true },
  },
  'garden-brunch': {
    id: 'garden-brunch',
    name: { he: 'בראנץ׳ בגינה', en: 'Garden Brunch', ar: 'فطور الحديقة' },
    palette: { bg: '#fff5f3', surface: '#ffffff', text: '#2d1f24', muted: '#664a52', accent: '#a8345a', accent2: '#4d7c5a' },
    fontDisplay: 'playfair-display', fontBody: 'rubik', displayWeight: 700, headingCase: 'none',
    layout: 'showcase', radius: 24, surface: 'card', texture: 'none', ornament: 'flourish', pattern: 'dots', heroStyle: 'split',
    effects: { reveal: true, tilt: true, ornaments: true, kenBurns: true },
  },
  'emerald-deco': {
    id: 'emerald-deco',
    name: { he: 'ארט דקו אמרלד', en: 'Emerald Deco', ar: 'آرت ديكو زمردي' },
    palette: { bg: '#0b2a24', surface: '#123a32', text: '#f3ecd8', muted: '#cbc2a8', accent: '#e2bd6c', accent2: '#2f7d6b' },
    fontDisplay: 'playfair-display', fontBody: 'heebo', displayWeight: 700, headingCase: 'uppercase',
    layout: 'list', radius: 0, surface: 'flat', texture: 'none', ornament: 'art-deco', pattern: 'arabesque', heroStyle: 'overlay',
    effects: { reveal: true, shimmer: true, ornaments: true, leaders: true, spotlight: true },
  },
  botanical: {
    id: 'botanical',
    name: { he: 'בוטני', en: 'Botanical', ar: 'نباتي' },
    palette: { bg: '#f4f1e8', surface: '#fffdf6', text: '#1f2d1f', muted: '#4a5a45', accent: '#3a6632', accent2: '#c7774a' },
    fontDisplay: 'frank-ruhl-libre', fontBody: 'rubik', displayWeight: 700, headingCase: 'none',
    layout: 'cards', radius: 18, surface: 'card', texture: 'paper', ornament: 'flourish', pattern: 'dots', heroStyle: 'split',
    effects: { reveal: true, ornaments: true, kenBurns: true, tilt: true },
  },
  brutalist: {
    id: 'brutalist',
    name: { he: 'ברוטליסטי', en: 'Brutalist', ar: 'وحشي' },
    palette: { bg: '#f2f0e9', surface: '#ffffff', text: '#0a0a0a', muted: '#3d3d3d', accent: '#1d3fd8', accent2: '#ffd400' },
    fontDisplay: 'secular-one', fontBody: 'heebo', displayWeight: 400, headingCase: 'uppercase',
    layout: 'cards', radius: 0, surface: 'card', texture: 'none', ornament: 'none', pattern: 'grid', heroStyle: 'classic',
    effects: { reveal: true },
  },
  sunset: {
    id: 'sunset',
    name: { he: 'שקיעה', en: 'Sunset', ar: 'غروب' },
    palette: { bg: '#2a1036', surface: '#3a1747', text: '#fff4ec', muted: '#f2cfc6', accent: '#ffb38a', accent2: '#ff5e7e' },
    fontDisplay: 'rubik', fontBody: 'rubik', displayWeight: 700, headingCase: 'none',
    layout: 'showcase', radius: 22, surface: 'glass', texture: 'none', ornament: 'none', pattern: 'waves', heroStyle: 'overlay',
    effects: { reveal: true, glass: true, bokeh: true, gradientBorder: true, kenBurns: true },
  },
};

/** Gray accents (e.g. Nordic's black) become the text color; colored ones keep their hue. */
function altAccent(accent: string, text: string, backgrounds: string[]): string {
  return hexToHsl(accent)[1] < 0.08 ? text : ensureContrast(accent, backgrounds);
}

/**
 * The theme's opposite: a light version of a dark theme or a dark version of a light one.
 * Built from the theme's own accent hues, then every text color is corrected to WCAG AA
 * against both the background and the card surface.
 */
export function deriveAltPalette(p: Palette): Palette {
  if (isDark(p.bg)) {
    const bg = mix('#ffffff', p.accent, 0.06);
    const surface = '#ffffff';
    const text = ensureContrast(mix('#14110f', p.accent, 0.12), [bg, surface], 7);
    return {
      bg,
      surface,
      text,
      muted: ensureContrast(mix(text, bg, 0.3), [bg, surface]),
      accent: altAccent(p.accent, text, [bg, surface]),
      accent2: p.accent2,
    };
  }
  const bg = mix('#0e0d10', p.accent, 0.1);
  const surface = mix(bg, '#ffffff', 0.07);
  const text = ensureContrast(mix('#f6f2ea', p.accent, 0.06), [bg, surface], 7);
  return {
    bg,
    surface,
    text,
    muted: ensureContrast(mix(text, bg, 0.3), [bg, surface]),
    accent: altAccent(p.accent, text, [bg, surface]),
    accent2: p.accent2,
  };
}

export function themePalette(theme: Theme, mode: Mode = 'original'): Palette {
  return mode === 'alt' ? deriveAltPalette(theme.palette) : theme.palette;
}

export interface FontPair {
  id: string;
  name: { he: string; en: string; ar: string };
  display: FontId;
  body: FontId;
}

/** Curated heading + body pairings. */
export const FONT_PAIRS: FontPair[] = [
  { id: 'classic', name: { he: 'אלגנטי קלאסי', en: 'Classic elegance', ar: 'أناقة كلاسيكية' }, display: 'playfair-display', body: 'heebo' },
  { id: 'literary', name: { he: 'ספרותי', en: 'Literary', ar: 'أدبي' }, display: 'cormorant-garamond', body: 'frank-ruhl-libre' },
  { id: 'modern', name: { he: 'מודרני נקי', en: 'Modern clean', ar: 'عصري نظيف' }, display: 'rubik', body: 'heebo' },
  { id: 'bold', name: { he: 'נועז', en: 'Bold display', ar: 'جريء' }, display: 'secular-one', body: 'rubik' },
  { id: 'handmade', name: { he: 'כתב יד', en: 'Handmade', ar: 'خط يدوي' }, display: 'amatic-sc', body: 'heebo' },
  { id: 'oriental', name: { he: 'מזרחי', en: 'Oriental', ar: 'شرقي' }, display: 'amiri', body: 'cairo' },
  { id: 'mediterranean', name: { he: 'ים־תיכוני', en: 'Mediterranean', ar: 'متوسطي' }, display: 'suez-one', body: 'rubik' },
  { id: 'poster', name: { he: 'פוסטר', en: 'Poster', ar: 'ملصق' }, display: 'bebas-neue', body: 'inter' },
];

export interface ResolvedDesign {
  theme: Theme;
  mode: Mode;
  palette: Palette;
  fontDisplay: FontId;
  fontBody: FontId;
  layout: Layout;
  heroStyle: HeroStyle;
  pattern: Pattern;
  radius: number;
  effects: Record<Effect, boolean>;
}

const NO_EFFECTS: Record<Effect, boolean> = {
  reveal: false, glass: false, glow: false, aurora: false, grain: false,
  tilt: false, shimmer: false, parallax: false, leaders: false, ornaments: false,
  spotlight: false, bokeh: false, gradientBorder: false, kenBurns: false,
};

/** Theme defaults merged with the user's overrides. */
export function resolveDesign(design: Design): ResolvedDesign {
  const theme = THEMES[design.theme];
  const mode = design.mode ?? 'original';
  return {
    theme,
    mode,
    palette: { ...themePalette(theme, mode), ...design.palette },
    fontDisplay: design.fontDisplay ?? theme.fontDisplay,
    fontBody: design.fontBody ?? theme.fontBody,
    layout: design.layout,
    heroStyle: design.heroStyle ?? theme.heroStyle ?? 'classic',
    pattern: design.pattern ?? theme.pattern ?? 'none',
    radius: design.radius ?? theme.radius,
    effects: { ...NO_EFFECTS, ...theme.effects, ...design.effects },
  };
}

/** Design for a freshly picked theme: keeps content-level choices, resets look & feel to the theme's. */
export function applyTheme(design: Design, themeId: ThemeId): Design {
  const theme = THEMES[themeId];
  return {
    ...design,
    theme: themeId,
    layout: theme.layout,
    heroStyle: undefined,
    pattern: undefined,
    mode: undefined,
    palette: {},
    fontDisplay: undefined,
    fontBody: undefined,
    radius: undefined,
    effects: {},
  };
}

const ACCENT_EFFECTS: Effect[] = ['spotlight', 'bokeh', 'gradientBorder', 'kenBurns', 'grain', 'shimmer', 'parallax'];

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length) % list.length]!;
}

/**
 * "Surprise me": a different theme with a curated twist (hero style, pattern, one or two extra effects).
 * Keeps content-level settings (images, allergens, nav) and stays within the theme's tested palette.
 */
export function surpriseDesign(design: Design, rand: () => number = Math.random): Design {
  const others = THEME_IDS.filter((id) => id !== design.theme);
  const themeId = pick(others, rand);
  const theme = THEMES[themeId];
  const base = applyTheme(design, themeId);
  const extras = new Set<Effect>();
  const count = 1 + Math.floor(rand() * 2);
  while (extras.size < count) extras.add(pick(ACCENT_EFFECTS, rand));
  const effects: Partial<Record<Effect, boolean>> = {};
  for (const fx of extras) effects[fx] = true;
  return {
    ...base,
    heroStyle: rand() < 0.5 ? theme.heroStyle : pick(HERO_STYLES, rand),
    pattern: rand() < 0.6 ? theme.pattern : pick(PATTERNS, rand),
    mode: rand() < 0.3 ? 'alt' : undefined,
    effects,
  };
}
