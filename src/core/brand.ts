/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * MenuAI attribution — the single source of the "Powered by MenuAI · Open source" credit.
 *
 * The credit is part of the product: it is rendered on every menu (preview, full-screen view,
 * exported file, print), in the editor, in server logs and CLI output. There is intentionally
 * no setting or menu label that turns it off. Tests and CI (scripts/check-attribution.mjs)
 * fail if it disappears. See NOTICE for the attribution terms.
 */
export const BRAND = {
  name: 'MenuAI',
  author: 'Diamond Rubinny',
  repo: 'https://github.com/diamondrubinny/menuai',
  license: 'AGPL-3.0',
} as const;

interface CreditText {
  poweredBy: string;
  openSource: string;
}

/** Fixed translations. Deliberately NOT part of the per-menu label overrides, so it can't be blanked out. */
const CREDIT: Record<string, CreditText> = {
  en: { poweredBy: 'Powered by', openSource: 'Open source' },
  he: { poweredBy: 'מופעל על ידי', openSource: 'קוד פתוח' },
  ar: { poweredBy: 'مدعوم من', openSource: 'مفتوح المصدر' },
  ru: { poweredBy: 'Работает на', openSource: 'Открытый код' },
  fr: { poweredBy: 'Propulsé par', openSource: 'Open source' },
  es: { poweredBy: 'Con la tecnología de', openSource: 'Código abierto' },
  de: { poweredBy: 'Betrieben mit', openSource: 'Open Source' },
  it: { poweredBy: 'Realizzato con', openSource: 'Open source' },
  pt: { poweredBy: 'Com tecnologia', openSource: 'Código aberto' },
  zh: { poweredBy: '技术支持', openSource: '开源' },
};

export function creditText(locale: string): CreditText {
  return CREDIT[locale] ?? CREDIT[locale.split('-')[0]!.toLowerCase()] ?? CREDIT.en!;
}

/** Plain-text credit line, e.g. for logs, CLI output and emails. */
export const CREDIT_LINE = `Powered by ${BRAND.name} · Open source (${BRAND.license}) · ${BRAND.repo}`;

/** HTML comment placed at the top of every exported menu file. */
export const CREDIT_COMMENT = `<!--\n  Made with ${BRAND.name} — open-source menu builder by ${BRAND.author}.\n  ${BRAND.license} License · ${BRAND.repo}\n-->`;
