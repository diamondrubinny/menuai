import { parseMenu, type Menu } from './schema';

const KEY = 'menuai:menu:v1';
const PREFS_KEY = 'menuai:prefs:v1';

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' };

/** Loads the draft menu. Corrupted or tampered data is ignored (returns null). */
export function loadMenu(): Menu | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const result = parseMenu(JSON.parse(raw));
    return result.ok ? result.menu : null;
  } catch {
    return null;
  }
}

export function saveMenu(menu: Menu): SaveResult {
  try {
    localStorage.setItem(KEY, JSON.stringify(menu));
    return { ok: true };
  } catch (err) {
    const quota = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unavailable' };
  }
}

export interface Prefs {
  uiLang?: string;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    if (data && typeof data === 'object' && typeof (data as Prefs).uiLang === 'string') {
      return { uiLang: (data as Prefs).uiLang };
    }
  } catch {
    // Storage blocked or corrupted.
  }
  return {};
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Non-critical.
  }
}
