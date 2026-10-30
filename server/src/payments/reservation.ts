/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * A checkout reserves its share, so two guests can't both pay the whole bill at once. After this long
 * the reservation may be released, but only after asking the provider (see releaseStaleCheckouts).
 * Providers whose hosted page can expire are asked to close it after the same time.
 */
export const RESERVATION_MINUTES = 20;
