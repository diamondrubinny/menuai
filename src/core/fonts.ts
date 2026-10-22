/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FontId } from './schema';
import { FONT_FILES, type FontFile } from './fontFiles.generated';
import { baseLang } from './locales';

export type FontKind = 'sans' | 'serif' | 'display' | 'hand';
export type Subset = 'latin' | 'latin-ext' | 'hebrew' | 'arabic' | 'cyrillic' | 'cyrillic-ext' | 'greek' | 'vietnamese';

export interface FontInfo {
  id: FontId;
  label: string;
  /** CSS family name used in @font-face. Prefixed to avoid clashing with locally installed fonts. */
  family: string;
  kind: FontKind;
  generic: 'sans-serif' | 'serif' | 'cursive';
}

export const FONTS: Record<FontId, FontInfo> = {
  heebo: { id: 'heebo', label: 'Heebo', family: 'MA Heebo', kind: 'sans', generic: 'sans-serif' },
  rubik: { id: 'rubik', label: 'Rubik', family: 'MA Rubik', kind: 'sans', generic: 'sans-serif' },
  'frank-ruhl-libre': { id: 'frank-ruhl-libre', label: 'Frank Ruhl Libre', family: 'MA Frank Ruhl Libre', kind: 'serif', generic: 'serif' },
  'suez-one': { id: 'suez-one', label: 'Suez One', family: 'MA Suez One', kind: 'display', generic: 'serif' },
  'secular-one': { id: 'secular-one', label: 'Secular One', family: 'MA Secular One', kind: 'display', generic: 'sans-serif' },
  'amatic-sc': { id: 'amatic-sc', label: 'Amatic SC', family: 'MA Amatic SC', kind: 'hand', generic: 'cursive' },
  'playfair-display': { id: 'playfair-display', label: 'Playfair Display', family: 'MA Playfair Display', kind: 'serif', generic: 'serif' },
  'cormorant-garamond': { id: 'cormorant-garamond', label: 'Cormorant Garamond', family: 'MA Cormorant Garamond', kind: 'serif', generic: 'serif' },
  cairo: { id: 'cairo', label: 'Cairo', family: 'MA Cairo', kind: 'sans', generic: 'sans-serif' },
  amiri: { id: 'amiri', label: 'Amiri', family: 'MA Amiri', kind: 'serif', generic: 'serif' },
  'bebas-neue': { id: 'bebas-neue', label: 'Bebas Neue', family: 'MA Bebas Neue', kind: 'display', generic: 'sans-serif' },
  inter: { id: 'inter', label: 'Inter', family: 'MA Inter', kind: 'sans', generic: 'sans-serif' },
};

/** Which bundled font covers a script when the chosen font doesn't, by style. */
const SCRIPT_FALLBACKS: Record<'hebrew' | 'arabic' | 'cyrillic' | 'greek', { serif: FontId; sans: FontId }> = {
  hebrew: { serif: 'frank-ruhl-libre', sans: 'heebo' },
  arabic: { serif: 'amiri', sans: 'cairo' },
  cyrillic: { serif: 'cormorant-garamond', sans: 'inter' },
  greek: { serif: 'inter', sans: 'inter' },
};

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", "Noto Sans", "Noto Sans CJK SC", "Noto Sans Thai", "Noto Sans Devanagari", Arial';

export function subsetsForLocales(locales: string[]): Subset[] {
  const set = new Set<Subset>(['latin', 'latin-ext']);
  for (const code of locales) {
    const l = baseLang(code);
    if (l === 'he' || l === 'yi') set.add('hebrew');
    if (['ar', 'fa', 'ur', 'ps', 'sd', 'ug', 'ckb'].includes(l)) set.add('arabic');
    if (['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'mn', 'tg'].includes(l)) {
      set.add('cyrillic');
      set.add('cyrillic-ext');
    }
    if (l === 'el') set.add('greek');
    if (l === 'vi') set.add('vietnamese');
  }
  return [...set];
}

function fontHasSubset(id: FontId, subset: Subset): boolean {
  return FONT_FILES.some((f) => f.family === id && f.subset === subset);
}

/** Primary font plus per-script fallbacks for the scripts the chosen font lacks. */
export function fontChain(id: FontId, locales: string[]): FontId[] {
  const info = FONTS[id];
  const style = info.kind === 'serif' || info.generic === 'serif' ? 'serif' : 'sans';
  const chain: FontId[] = [id];
  for (const subset of subsetsForLocales(locales)) {
    if (subset !== 'hebrew' && subset !== 'arabic' && subset !== 'cyrillic' && subset !== 'greek') continue;
    if (fontHasSubset(id, subset)) continue;
    const fb = SCRIPT_FALLBACKS[subset][style];
    if (!chain.includes(fb)) chain.push(fb);
  }
  return chain;
}

export function fontStack(id: FontId, locales: string[]): string {
  const names = fontChain(id, locales).map((f) => `"${FONTS[f].family}"`);
  return `${names.join(', ')}, ${SYSTEM_STACK}, ${FONTS[id].generic}`;
}

/** Font files needed to render the given fonts in the given locales. */
export function requiredFontFiles(fonts: FontId[], locales: string[]): FontFile[] {
  const families = new Set(fonts.flatMap((f) => fontChain(f, locales)));
  const subsets = new Set(subsetsForLocales(locales));
  return FONT_FILES.filter((f) => families.has(f.family as FontId) && subsets.has(f.subset as Subset));
}

export function fontFaceCss(files: FontFile[], srcFor: (f: FontFile) => string = (f) => f.url): string {
  return files
    .map((f) => {
      const family = FONTS[f.family as FontId]?.family ?? f.family;
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${srcFor(f)}) format("woff2");unicode-range:${f.unicodeRange};}`;
    })
    .join('\n');
}

let installed = false;
/** Registers every bundled font in the editor. Browsers only download files actually used (unicode-range). */
export function installAllFonts(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const style = document.createElement('style');
  style.dataset.menuaiFonts = '';
  style.textContent = fontFaceCss(FONT_FILES);
  document.head.appendChild(style);
}
