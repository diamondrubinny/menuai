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
import { saveMenu } from '../core/storage';
import { dataUrlToBlob, uploadImage } from '../api/uploads';
import { mapMenuImages, menuImages } from '../core/menuImages';
import { useFeedback } from './feedbackStore';

const EVENT_TEXT: Record<SyncEvent, { key: UiKey; kind: 'info' | 'success' | 'error' }> = {
  remoteLoaded: { key: 'cloudRemoteLoaded', kind: 'info' },
  deletedRemotely: { key: 'cloudDeletedRemotely', kind: 'error' },
  tooLarge: { key: 'cloudTooLarge', kind: 'error' },
  invalid: { key: 'cloudInvalid', kind: 'error' },
  uploaded: { key: 'cloudUploaded', kind: 'success' },
  opened: { key: 'cloudOpened', kind: 'success' },
};

/** True only while a server version is being loaded: that change is not a local edit (an undo back to it later is). */
let applyingRemote = false;

/** Loads a server version into the editor (used by the sync engine; exported for tests). */
export function applyServerMenu(menu: Menu): void {
  applyingRemote = true;
  try {
    useMenuStore.getState().load(menu);
  } finally {
    applyingRemote = false;
  }
  // Persist now, not on the autosave debounce: the cloud link (new version, clean) is written right after,
  // and a reload in between must never pair that link with the previous menu.
  saveMenu(menu);
}

export const cloud = createCloudSync({
  getMenu: () => useMenuStore.getState().menu,
  loadMenu: applyServerMenu,
  onEvent: (event) => {
    const { key, kind } = EVENT_TEXT[event];
    useFeedback.getState().notify(translate(useUiLang.getState().lang, key), kind);
  },
});

useMenuStore.subscribe((state, prev) => {
  if (state.menu !== prev.menu && !applyingRemote) cloud.localChanged();
});

if (typeof window !== 'undefined') {
  // Coming back to the editor tab (e.g. after editing on the phone): pick up newer versions.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void cloud.refresh();
  });
  window.addEventListener('online', () => void cloud.flush());
}

/** Images go to the server only for a cloud menu the user may edit; local menus keep embedding them. */
export function canUploadImages(): boolean {
  const { connection, link, user } = cloud.store.getState();
  return connection === 'ready' && link !== null && (user?.role === 'owner' || user?.role === 'editor');
}

export type StoredImage = { src: string; embedded?: true } | { error: 'rejected' | 'invalid' };

/**
 * Where a freshly processed image (data URL) should live: on the server (scanned + re-encoded) for a
 * cloud menu, or embedded in the menu otherwise. If the server cannot take it right now, it is embedded.
 */
export async function storeImage(dataUrl: string): Promise<StoredImage> {
  if (!canUploadImages()) return { src: dataUrl };
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return { src: dataUrl };
  const result = await uploadImage(blob);
  if (result.ok) return { src: result.url };
  if (result.error === 'rejected' || result.error === 'invalid') return { error: result.error };
  return { src: dataUrl, embedded: true };
}

export const isEmbedded = (src: string) => src.startsWith('data:');

export function embeddedImageCount(): number {
  return new Set(menuImages(useMenuStore.getState().menu).map((i) => i.src).filter(isEmbedded)).size;
}

/** Uploads every image embedded in the menu and swaps in the server URLs. Returns how many moved and failed. */
export async function moveImagesToServer(): Promise<{ moved: number; failed: number }> {
  let moved = 0;
  let failed = 0;
  const before = useMenuStore.getState().menu;
  const next = await mapMenuImages(before, async (src) => {
    if (!isEmbedded(src)) return src;
    const blob = dataUrlToBlob(src);
    const result = blob ? await uploadImage(blob) : null;
    if (result?.ok) {
      moved++;
      return result.url;
    }
    failed++;
    return src;
  });
  if (moved > 0) {
    // Apply to the current menu (edits made meanwhile are kept): only swap the sources that moved.
    const map = new Map<string, string>();
    menuImages(before).forEach((img, i) => map.set(img.src, menuImages(next)[i]!.src));
    const current = useMenuStore.getState().menu;
    const updated = await mapMenuImages(current, async (src) => map.get(src) ?? src);
    useMenuStore.getState().update(() => updated);
  }
  return { moved, failed };
}

export function useCloud<T>(selector: (state: CloudState) => T): T {
  return useStore(cloud.store, selector);
}
