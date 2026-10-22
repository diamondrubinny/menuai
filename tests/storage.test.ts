/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMenu, saveMenu } from '../src/core/storage';
import { createSampleMenu } from '../src/core/sample';

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('saves and loads a menu', () => {
    const menu = createSampleMenu();
    expect(saveMenu(menu).ok).toBe(true);
    expect(loadMenu()).toEqual(menu);
  });

  it('ignores corrupted or tampered data', () => {
    localStorage.setItem('menuai:menu:v1', '{broken');
    expect(loadMenu()).toBeNull();
    localStorage.setItem('menuai:menu:v1', JSON.stringify({ ...createSampleMenu(), logo: { src: 'javascript:alert(1)' } }));
    expect(loadMenu()).toBeNull();
  });
});
