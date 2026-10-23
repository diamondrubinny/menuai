/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { describe, expect, it } from 'vitest';
import { createSampleMenu } from '../src/core/sample';
import { IMAGE_SRC_RE, MEDIA_SRC_RE, parseMenu, type Menu } from '../src/core/schema';
import { mapMenuImages, menuImages } from '../src/core/menuImages';
import { exportMenuHtml } from '../src/core/exportHtml';
import { dataUrlToBlob } from '../src/api/uploads';

const ID = '6f1c1f1e-8a5e-4c3e-9d55-3b1f0a2b7c11';
const MEDIA = `/media/${ID}.webp`;

function withImages(): Menu {
  const menu = createSampleMenu();
  const section = menu.sections[0]!;
  return {
    ...menu,
    hero: { src: MEDIA, alt: {} },
    logo: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: {} },
    sections: [{ ...section, image: { src: MEDIA, alt: {} }, items: section.items.map((i, n) => (n === 0 ? { ...i, image: { src: 'https://img.example.com/a.jpg', alt: {} } } : i)) }, ...menu.sections.slice(1)],
  };
}

describe('server image URLs in the schema', () => {
  it('accepts only /media/<uuid>.webp, nothing else on the same origin', () => {
    expect(MEDIA_SRC_RE.test(MEDIA)).toBe(true);
    for (const bad of ['/media/../api/me', `/media/${ID}.svg`, `/media/${ID}.webp?x=1`, '/api/uploads/1', `//evil.example/media/${ID}.webp`, `/media/${ID.toUpperCase()}.webp`]) {
      expect(IMAGE_SRC_RE.test(bad), bad).toBe(false);
    }
    expect(parseMenu(withImages()).ok).toBe(true);
  });
});

describe('menu image helpers', () => {
  it('finds every image and maps each distinct source once', async () => {
    const menu = withImages();
    expect(menuImages(menu).map((i) => i.src)).toEqual([menu.logo!.src, MEDIA, MEDIA, 'https://img.example.com/a.jpg']);
    const seen: string[] = [];
    const mapped = await mapMenuImages(menu, async (src) => {
      seen.push(src);
      return src === MEDIA ? 'data:image/webp;base64,AAAA' : src;
    });
    expect(seen.sort()).toEqual([MEDIA, menu.logo!.src, 'https://img.example.com/a.jpg'].sort());
    expect(mapped.hero!.src).toBe('data:image/webp;base64,AAAA');
    expect(mapped.sections[0]!.image!.src).toBe('data:image/webp;base64,AAAA');
    expect(mapped.logo!.src).toBe(menu.logo!.src);
    expect(menu.hero!.src).toBe(MEDIA); // input untouched
  });
});

describe('export with server images', () => {
  it('embeds /media images in a downloaded file so it works anywhere', async () => {
    const html = await exportMenuHtml(withImages(), { embedFonts: false, loadMedia: async () => 'UklGRg==' });
    expect(html).not.toContain('/media/');
    expect(html).toContain('data:image/webp;base64,UklGRg==');
    expect(html).toMatch(/img-src data: https:;/);
  });

  it('links /media images for menus published by the server and allows them in the CSP', async () => {
    const html = await exportMenuHtml(withImages(), { embedFonts: false, media: 'link' });
    expect(html).toContain(`src="${MEDIA}"`);
    expect(html).toContain("img-src 'self' data: https:");
  });
});

describe('data URL to upload body', () => {
  it('converts editor data URLs and rejects anything else', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=')!;
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(dataUrlToBlob('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(dataUrlToBlob(MEDIA)).toBeNull();
  });
});
