/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyServerMenu, cloud } from '../src/store/cloudStore';
import { useMenuStore } from '../src/store/menuStore';
import { createSampleMenu } from '../src/core/sample';
import { loadMenu } from '../src/core/storage';

afterEach(() => vi.restoreAllMocks());

describe('cloud store wiring', () => {
  it('does not treat a server load as an edit, but does treat an undo back to it as one', () => {
    const changed = vi.spyOn(cloud, 'localChanged').mockImplementation(() => {});
    const server = { ...createSampleMenu(), title: { en: 'From server' } };
    applyServerMenu(server);
    expect(changed).not.toHaveBeenCalled();

    useMenuStore.getState().update((m) => ({ ...m, title: { en: 'Edited' } }));
    expect(changed).toHaveBeenCalledTimes(1);

    // Undo returns to the exact object that came from the server: still a change the server must receive.
    useMenuStore.getState().undo();
    expect(useMenuStore.getState().menu).toBe(server);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('saves a server version locally at once, before the cloud link records its version', () => {
    vi.spyOn(cloud, 'localChanged').mockImplementation(() => {});
    const server = { ...createSampleMenu(), title: { en: 'Saved immediately' } };
    applyServerMenu(server);
    expect(loadMenu()?.title.en).toBe('Saved immediately'); // no 400 ms autosave window
  });
});
