/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { create } from 'zustand';
import type { Design, Item, Menu, Section, ThemeId } from '../core/schema';
import { applyTheme } from '../core/themes';
import { createSampleMenu } from '../core/sample';
import { loadMenu, saveMenu, type SaveResult } from '../core/storage';
import { newId } from '../core/ids';

const HISTORY_LIMIT = 80;
/** Edits to the same field within this window are merged into one undo step. */
const COALESCE_MS = 700;

type Updater = (menu: Menu) => Menu;

interface MenuState {
  menu: Menu;
  past: Menu[];
  future: Menu[];
  lastKey: string | null;
  lastAt: number;
  saveStatus: SaveResult | null;

  /** Apply a change. `key` groups rapid edits (typing) into a single undo step. */
  update: (fn: Updater, key?: string) => void;
  replace: (menu: Menu) => void;
  undo: () => void;
  redo: () => void;

  setDesign: (patch: Partial<Design>, key?: string) => void;
  setTheme: (theme: ThemeId) => void;
  updateSection: (sectionId: string, fn: (s: Section) => Section, key?: string) => void;
  updateItem: (sectionId: string, itemId: string, fn: (i: Item) => Item, key?: string) => void;
  addSection: () => string;
  removeSection: (sectionId: string) => void;
  moveSection: (sectionId: string, delta: -1 | 1) => void;
  addItem: (sectionId: string) => string;
  duplicateItem: (sectionId: string, itemId: string) => void;
  removeItem: (sectionId: string, itemId: string) => void;
  moveItem: (sectionId: string, itemId: string, delta: -1 | 1) => void;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const copy = list.slice();
  const [entry] = copy.splice(index, 1);
  copy.splice(target, 0, entry!);
  return copy;
}

export function emptyItem(): Item {
  return {
    id: newId('i'), name: {}, description: {}, variants: [], tags: [], allergens: [],
    spicy: 0, soldOut: false, hidden: false,
  };
}

export const useMenuStore = create<MenuState>((set, get) => {
  const mapSections = (fn: (sections: Section[]) => Section[], key?: string) =>
    get().update((m) => ({ ...m, sections: fn(m.sections) }), key);

  return {
    menu: loadMenu() ?? createSampleMenu(),
    past: [],
    future: [],
    lastKey: null,
    lastAt: 0,
    saveStatus: null,

    update: (fn, key) => {
      const { menu, past, lastKey, lastAt } = get();
      const next = { ...fn(menu), updatedAt: new Date().toISOString() };
      const now = Date.now();
      const coalesce = key !== undefined && key === lastKey && now - lastAt < COALESCE_MS;
      set({
        menu: next,
        past: coalesce ? past : [...past.slice(-HISTORY_LIMIT + 1), menu],
        future: [],
        lastKey: key ?? null,
        lastAt: now,
      });
    },

    replace: (menu) => {
      const { menu: current, past } = get();
      set({ menu, past: [...past.slice(-HISTORY_LIMIT + 1), current], future: [], lastKey: null });
    },

    undo: () => {
      const { past, menu, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({ menu: previous, past: past.slice(0, -1), future: [menu, ...future], lastKey: null });
    },

    redo: () => {
      const { past, menu, future } = get();
      const next = future[0];
      if (!next) return;
      set({ menu: next, past: [...past, menu], future: future.slice(1), lastKey: null });
    },

    setDesign: (patch, key) => get().update((m) => ({ ...m, design: { ...m.design, ...patch } }), key),

    setTheme: (theme) => get().update((m) => ({ ...m, design: applyTheme(m.design, theme) })),

    updateSection: (sectionId, fn, key) =>
      mapSections((list) => list.map((s) => (s.id === sectionId ? fn(s) : s)), key),

    updateItem: (sectionId, itemId, fn, key) =>
      mapSections(
        (list) =>
          list.map((s) =>
            s.id === sectionId ? { ...s, items: s.items.map((i) => (i.id === itemId ? fn(i) : i)) } : s,
          ),
        key,
      ),

    addSection: () => {
      const id = newId('s');
      mapSections((list) => [...list, { id, title: {}, description: {}, items: [emptyItem()], hidden: false }]);
      return id;
    },

    removeSection: (sectionId) => mapSections((list) => list.filter((s) => s.id !== sectionId)),

    moveSection: (sectionId, delta) =>
      mapSections((list) => move(list, list.findIndex((s) => s.id === sectionId), delta)),

    addItem: (sectionId) => {
      const item = emptyItem();
      mapSections((list) => list.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, item] } : s)));
      return item.id;
    },

    duplicateItem: (sectionId, itemId) =>
      mapSections((list) =>
        list.map((s) => {
          if (s.id !== sectionId) return s;
          const index = s.items.findIndex((i) => i.id === itemId);
          const source = s.items[index];
          if (!source) return s;
          const copy: Item = {
            ...structuredClone(source),
            id: newId('i'),
            variants: source.variants.map((v) => ({ ...v, id: newId('v') })),
          };
          const items = s.items.slice();
          items.splice(index + 1, 0, copy);
          return { ...s, items };
        }),
      ),

    removeItem: (sectionId, itemId) =>
      mapSections((list) =>
        list.map((s) => (s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s)),
      ),

    moveItem: (sectionId, itemId, delta) =>
      mapSections((list) =>
        list.map((s) =>
          s.id === sectionId ? { ...s, items: move(s.items, s.items.findIndex((i) => i.id === itemId), delta) } : s,
        ),
      ),
  };
});

// Debounced autosave to localStorage.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useMenuStore.subscribe((state, prev) => {
  if (state.menu === prev.menu) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const result = saveMenu(useMenuStore.getState().menu);
    useMenuStore.setState({ saveStatus: result });
  }, 400);
});
