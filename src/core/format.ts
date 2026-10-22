const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    cache.set(key, f);
  }
  return f;
}

/** Locale-aware price, e.g. "₪48" (he) / "48 ₪" / "$12.50". */
export function formatPrice(value: number, locale: string, currency: string): string {
  return formatter(locale, currency).format(value);
}

export const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'EGP', 'JOD', 'TRY', 'RUB', 'UAH', 'CHF', 'JPY', 'CNY', 'INR', 'THB', 'CAD', 'AUD', 'BRL', 'MXN'] as const;
