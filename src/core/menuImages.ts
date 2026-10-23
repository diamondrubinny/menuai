/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { ImageRef, Menu } from './schema';

/** Every image reference in a menu: logo, cover, section banners and dishes. */
export function menuImages(menu: Menu): ImageRef[] {
  const list: ImageRef[] = [];
  if (menu.logo) list.push(menu.logo);
  if (menu.hero) list.push(menu.hero);
  for (const s of menu.sections) {
    if (s.image) list.push(s.image);
    for (const i of s.items) if (i.image) list.push(i.image);
  }
  return list;
}

/**
 * Returns a copy of the menu with image sources replaced by `replace(src)` (called once per distinct src,
 * in parallel). Sources it maps to themselves are left as they are.
 */
export async function mapMenuImages(menu: Menu, replace: (src: string) => Promise<string>): Promise<Menu> {
  const sources = [...new Set(menuImages(menu).map((i) => i.src))];
  const mapped = new Map(await Promise.all(sources.map(async (src) => [src, await replace(src)] as const)));
  const swap = <T extends ImageRef | undefined>(img: T): T => (img ? { ...img, src: mapped.get(img.src) ?? img.src } : img);
  return {
    ...menu,
    logo: swap(menu.logo),
    hero: swap(menu.hero),
    sections: menu.sections.map((s) => ({ ...s, image: swap(s.image), items: s.items.map((i) => ({ ...i, image: swap(i.image) })) })),
  };
}
