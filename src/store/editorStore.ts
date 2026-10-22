/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { create } from 'zustand';

export type Tab = 'content' | 'design' | 'languages' | 'publish';
export type Device = 'phone' | 'tablet' | 'desktop' | 'tv';

export const DEVICE_SIZES: Record<Device, { w: number; h: number }> = {
  phone: { w: 390, h: 844 },
  tablet: { w: 820, h: 1180 },
  desktop: { w: 1366, h: 860 },
  tv: { w: 1920, h: 1080 },
};

interface EditorState {
  tab: Tab;
  editLocale: string | null;
  previewLocale: string | null;
  device: Device;
  landscape: boolean;
  mobileView: 'edit' | 'preview';
  setTab: (tab: Tab) => void;
  setEditLocale: (code: string) => void;
  setPreviewLocale: (code: string) => void;
  setDevice: (device: Device) => void;
  toggleLandscape: () => void;
  setMobileView: (view: 'edit' | 'preview') => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tab: 'content',
  editLocale: null,
  previewLocale: null,
  device: 'phone',
  landscape: false,
  mobileView: 'edit',
  setTab: (tab) => set({ tab }),
  setEditLocale: (editLocale) => set({ editLocale, previewLocale: editLocale }),
  setPreviewLocale: (previewLocale) => set({ previewLocale }),
  setDevice: (device) => set({ device, landscape: false }),
  toggleLandscape: () => set((s) => ({ landscape: !s.landscape })),
  setMobileView: (mobileView) => set({ mobileView }),
}));
