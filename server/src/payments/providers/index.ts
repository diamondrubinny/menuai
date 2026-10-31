/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { Config } from '../../config';
import { fakeProvider } from './fake';
import { growProvider, type Http } from './grow';
import { payplusProvider } from './payplus';
import type { PaymentMode, PaymentProvider, ProviderId } from './types';

/** Providers that can actually be used on this installation. */
export function availableProviders(config: Config): ProviderId[] {
  return config.PAYMENTS_ALLOW_FAKE ? ['grow', 'payplus', 'fake'] : ['grow', 'payplus'];
}

/** Whether `mode` may be used with `provider` here (live only after a sandbox run: PAYMENTS_LIVE_PROVIDERS). */
export function modeAllowed(config: Config, provider: ProviderId, mode: PaymentMode): boolean {
  if (mode === 'test') return true;
  return provider !== 'fake' && (config.PAYMENTS_LIVE_PROVIDERS as string[]).includes(provider);
}

/** Builds the adapter for the stored settings, or null when it is not available or not set up. */
export function createProvider(
  config: Config,
  settings: { provider: ProviderId; mode: PaymentMode; credentials: Record<string, string> | null },
  http?: Http,
): PaymentProvider | null {
  if (!availableProviders(config).includes(settings.provider) || !modeAllowed(config, settings.provider, settings.mode)) return null;
  switch (settings.provider) {
    case 'fake':
      return fakeProvider(config.PUBLIC_URL);
    case 'grow': {
      const { userId, pageCode } = settings.credentials ?? {};
      return userId && pageCode ? growProvider({ userId, pageCode }, settings.mode, http) : null;
    }
    case 'payplus': {
      const { apiKey, secretKey, paymentPageUid } = settings.credentials ?? {};
      return apiKey && secretKey && paymentPageUid ? payplusProvider({ apiKey, secretKey, paymentPageUid }, settings.mode, http) : null;
    }
    default:
      return null;
  }
}
