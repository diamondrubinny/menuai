/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/** Adds the cart (order from the menu) when the server has ordering on for this table. */
export function initTableOrder(doc: Document, code: string, opts?: { fetch?: typeof fetch }): Promise<boolean>;
