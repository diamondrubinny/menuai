/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
export interface MenuRuntime {
  refresh(): void;
  destroy(): void;
}

export function initMenuRuntime(
  container: HTMLElement,
  options?: { scrollRoot?: Element | null; syncUrl?: boolean },
): MenuRuntime;
