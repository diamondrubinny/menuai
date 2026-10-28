/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { Config } from '../../config';
import { fakeProvider } from './fake';
import type { PaymentMode, PaymentProvider, ProviderId } from './types';

/** Providers that can actually be used on this installation. */
export function availableProviders(config: Config): ProviderId[] {
  // Grow joins in Phase 3b (docs/PAYMENTS_PLAN.md), once tested end to end against its sandbox.
  return config.PAYMENTS_ALLOW_FAKE ? ['fake'] : [];
}

/** Builds the adapter for the stored settings, or null when it is not available here. */
export function createProvider(
  config: Config,
  settings: { provider: ProviderId; mode: PaymentMode; credentials: Record<string, string> | null },
): PaymentProvider | null {
  if (!availableProviders(config).includes(settings.provider)) return null;
  switch (settings.provider) {
    case 'fake':
      return fakeProvider(config.PUBLIC_URL);
    default:
      return null;
  }
}
