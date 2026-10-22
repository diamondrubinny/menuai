export type Direction = 'ltr' | 'rtl';

export interface LocaleInfo {
  code: string;
  nativeName: string;
  englishName: string;
  dir: Direction;
}

/** Content languages offered in the picker. Any BCP-47 code can still be added manually. */
export const LOCALES: LocaleInfo[] = [
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew', dir: 'rtl' },
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', dir: 'ltr' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', dir: 'ltr' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', dir: 'ltr' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', dir: 'ltr' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian', dir: 'ltr' },
  { code: 'ro', nativeName: 'Română', englishName: 'Romanian', dir: 'ltr' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek', dir: 'ltr' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', dir: 'ltr' },
  { code: 'am', nativeName: 'አማርኛ', englishName: 'Amharic', dir: 'ltr' },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian', dir: 'rtl' },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu', dir: 'rtl' },
  { code: 'yi', nativeName: 'ייִדיש', englishName: 'Yiddish', dir: 'rtl' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', dir: 'ltr' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai', dir: 'ltr' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', dir: 'ltr' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', dir: 'ltr' },
  { code: 'zh', nativeName: '中文', englishName: 'Chinese', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', dir: 'ltr' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', dir: 'ltr' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish', dir: 'ltr' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian', dir: 'ltr' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', dir: 'ltr' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech', dir: 'ltr' },
  { code: 'hu', nativeName: 'Magyar', englishName: 'Hungarian', dir: 'ltr' },
  { code: 'ka', nativeName: 'ქართული', englishName: 'Georgian', dir: 'ltr' },
];

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv', 'ckb', 'syr']);

/** Matches simple BCP-47 tags such as "he", "pt-BR", "zh-Hant". */
export const LOCALE_CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

export function baseLang(code: string): string {
  return code.split('-')[0]!.toLowerCase();
}

export function getLocaleInfo(code: string): LocaleInfo {
  const found = LOCALES.find((l) => l.code === code) ?? LOCALES.find((l) => l.code === baseLang(code));
  if (found) return found.code === code ? found : { ...found, code };
  let name = code;
  try {
    name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    // Invalid or unsupported tag: fall back to the raw code.
  }
  return { code, nativeName: name, englishName: name, dir: RTL_LANGS.has(baseLang(code)) ? 'rtl' : 'ltr' };
}

export function dirOf(code: string): Direction {
  return getLocaleInfo(code).dir;
}
