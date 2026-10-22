/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useStore } from 'zustand';
import type { Menu } from '../core/schema';
import { createCloudSync, type CloudState, type SyncEvent } from '../cloud/sync';
import { translate, useUiLang, type UiKey } from '../i18n/ui';
import { useMenuStore } from './menuStore';
import { useFeedback } from './feedbackStore';

const EVENT_TEXT: Record<SyncEvent, { key: UiKey; kind: 'info' | 'success' | 'error' }> = {
  remoteLoaded: { key: 'cloudRemoteLoaded', kind: 'info' },
  deletedRemotely: { key: 'cloudDeletedRemotely', kind: 'error' },
  tooLarge: { key: 'cloudTooLarge', kind: 'error' },
  invalid: { key: 'cloudInvalid', kind: 'error' },
  uploaded: { key: 'cloudUploaded', kind: 'success' },
  opened: { key: 'cloudOpened', kind: 'success' },
};

/** The last menu that came from the server: loading it must not count as a local edit. */
let remoteApplied: Menu | null = null;

export const cloud = createCloudSync({
  getMenu: () => useMenuStore.getState().menu,
  loadMenu: (menu) => {
    remoteApplied = menu;
    useMenuStore.getState().load(menu);
  },
  onEvent: (event) => {
    const { key, kind } = EVENT_TEXT[event];
    useFeedback.getState().notify(translate(useUiLang.getState().lang, key), kind);
  },
});

useMenuStore.subscribe((state, prev) => {
  if (state.menu !== prev.menu && state.menu !== remoteApplied) cloud.localChanged();
});

if (typeof window !== 'undefined') {
  // Coming back to the editor tab (e.g. after editing on the phone): pick up newer versions.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void cloud.refresh();
  });
  window.addEventListener('online', () => void cloud.flush());
}

export function useCloud<T>(selector: (state: CloudState) => T): T {
  return useStore(cloud.store, selector);
}
