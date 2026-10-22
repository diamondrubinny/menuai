/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudSync, LINK_KEY, type CloudSync, type SyncEvent } from '../src/cloud/sync';
import type { ApiResult } from '../src/api/client';
import { createSampleMenu } from '../src/core/sample';
import type { Menu } from '../src/core/schema';

const MENU_ID = '6f1c1f1e-8a5e-4c3e-9d55-3b1f0a2b7c11';
type Role = 'owner' | 'editor' | 'viewer';

/** In-memory fake of the MenuAI menus API with the same optimistic-locking rules as the server. */
class FakeServer {
  role: Role | null = 'editor';
  down = false;
  version = 1;
  draft: Menu = createSampleMenu();
  exists = true;
  calls: string[] = [];

  api = async <T,>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> => {
    const method = init.method ?? 'GET';
    this.calls.push(`${method} ${path}`);
    const ok = (data: unknown, status = 200) => ({ ok: true as const, status, data: data as T, etag: `"${this.version}"` });
    const fail = (status: number, error: string, body?: Record<string, unknown>) => ({ ok: false as const, status, error, ...(body ? { body } : {}) });
    if (this.down) return fail(0, 'network');
    if (path === '/me') return this.role ? ok({ user: { id: 'u', email: 'e@example.com', name: 'Dana', role: this.role } }) : fail(401, 'unauthorized');
    if (path === '/auth/sign-out') return ok({ ok: true });
    if (!this.role) return fail(401, 'unauthorized');
    const full = () => ({ id: MENU_ID, slug: 'lumiere', draftVersion: this.version, updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Noa', draft: this.draft });
    if (path === '/menus' && method === 'GET') return ok({ menus: [{ ...full(), title: 'Lumière', draft: undefined }] });
    if (path === '/menus' && method === 'POST') {
      if (this.role === 'viewer') return fail(403, 'forbidden');
      this.exists = true;
      this.version = 1;
      this.draft = (init.body as { menu: Menu }).menu;
      return ok({ menu: full() }, 201);
    }
    if (path === `/menus/${MENU_ID}`) {
      if (!this.exists) return fail(404, 'not_found');
      if (method === 'GET') {
        if (init.headers?.['if-none-match'] === `"${this.version}"`) return { ok: true, status: 304, data: null as T, etag: `"${this.version}"` };
        return ok({ menu: full() });
      }
      if (method === 'PUT') {
        if (this.role === 'viewer') return fail(403, 'forbidden');
        if (init.headers?.['if-match'] !== `"${this.version}"`) {
          return fail(409, 'version_conflict', { error: 'version_conflict', draftVersion: this.version, updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Noa' });
        }
        this.version += 1;
        this.draft = init.body as Menu;
        return ok({ menu: { id: MENU_ID, slug: 'lumiere', draftVersion: this.version } });
      }
    }
    return fail(404, 'not_found');
  };

  /** Simulates a save from another device. */
  remoteEdit(title: string) {
    this.version += 1;
    this.draft = { ...this.draft, title: { ...this.draft.title, en: title } };
  }
}

let server: FakeServer;
let menu: Menu;
let storage: Map<string, string>;
let events: SyncEvent[];
let sync: CloudSync;

const memoryStorage = () => ({
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
});

function makeSync() {
  sync = createCloudSync({
    getMenu: () => menu,
    loadMenu: (m) => { menu = m; },
    onEvent: (e) => events.push(e),
    api: server.api,
    storage: memoryStorage(),
    debounceMs: 100,
  });
  return sync;
}

/** Local edit, as the editor store would report it. */
function edit(title: string) {
  menu = { ...menu, title: { ...menu.title, en: title } };
  sync.localChanged();
}

function linkTo(version: number, dirty = false) {
  storage.set(LINK_KEY, JSON.stringify({ menuId: MENU_ID, slug: 'lumiere', version, dirty }));
}

const state = () => sync.store.getState();

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  menu = createSampleMenu();
  storage = new Map();
  events = [];
});
afterEach(() => {
  sync?.dispose();
  vi.useRealTimers();
});

describe('cloud sync — connection', () => {
  it('detects a missing server and stays local', async () => {
    server.down = true;
    await makeSync().init();
    expect(state()).toMatchObject({ connection: 'noServer', status: 'local', link: null });
  });

  it('detects a signed-out user and keeps unsent changes pending', async () => {
    server.role = null;
    linkTo(1, true);
    await makeSync().init();
    expect(state()).toMatchObject({ connection: 'signedOut', status: 'pending' });
  });

  it('ignores a corrupted link record', async () => {
    storage.set(LINK_KEY, '{"menuId":"../../etc","version":1,"dirty":false,"slug":"x"}');
    await makeSync().init();
    expect(state().link).toBeNull();
  });
});

describe('cloud sync — upload and autosave', () => {
  it('uploads the local menu, then autosaves edits with If-Match after the debounce', async () => {
    await makeSync().init();
    expect(await sync.uploadCurrent()).toBe(true);
    expect(events).toContain('uploaded');
    expect(state().link).toMatchObject({ menuId: MENU_ID, version: 1, dirty: false });
    expect(JSON.parse(storage.get(LINK_KEY)!)).toMatchObject({ menuId: MENU_ID, version: 1 });

    edit('One');
    edit('Two');
    expect(state()).toMatchObject({ status: 'saving' });
    expect(state().link!.dirty).toBe(true);
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toHaveLength(1); // debounced into one request
    expect(server.draft.title.en).toBe('Two');
    expect(state()).toMatchObject({ status: 'saved', link: { version: 2, dirty: false } });
  });

  it('keeps edits made during an in-flight save and sends them next', async () => {
    linkTo(1);
    await makeSync().init();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realApi = server.api;
    server.api = async (path, init) => {
      if (init?.method === 'PUT' && server.version === 1) await gate;
      return realApi(path, init);
    };
    makeSync(); // re-create with the gated api
    await sync.init();
    edit('First');
    await vi.advanceTimersByTimeAsync(150);
    edit('Second'); // while the first PUT is pending
    release();
    await vi.advanceTimersByTimeAsync(300);
    expect(server.draft.title.en).toBe('Second');
    expect(state().link).toMatchObject({ version: 3, dirty: false });
  });

  it('retries with backoff when offline and keeps changes dirty', async () => {
    linkTo(1);
    await makeSync().init();
    server.down = true;
    edit('Offline edit');
    await vi.advanceTimersByTimeAsync(150);
    expect(state().status).toBe('offline');
    expect(state().link!.dirty).toBe(true);
    server.down = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state().status).toBe('saved');
    expect(server.draft.title.en).toBe('Offline edit');
  });

  it('sends changes left dirty by a previous session on start-up', async () => {
    linkTo(1, true);
    menu = { ...menu, title: { en: 'Edited while closed' } };
    await makeSync().init();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.draft.title.en).toBe('Edited while closed');
    expect(state().link).toMatchObject({ version: 2, dirty: false });
  });

  it('never pushes for viewers', async () => {
    server.role = 'viewer';
    linkTo(1);
    await makeSync().init();
    expect(state().status).toBe('readonly');
    edit('Viewer edit');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    expect(state().status).toBe('readonly');
    expect(await sync.uploadCurrent()).toBe(false);
  });
});

describe('cloud sync — other devices', () => {
  it('loads a newer server version automatically when there are no local changes', async () => {
    linkTo(1);
    server.remoteEdit('From the phone');
    await makeSync().init();
    expect(menu.title.en).toBe('From the phone');
    expect(events).toContain('remoteLoaded');
    expect(state()).toMatchObject({ status: 'saved', link: { version: 2, dirty: false } });
  });

  it('uses a cheap 304 check when nothing changed', async () => {
    linkTo(1);
    await makeSync().init();
    expect(server.calls).toEqual(['GET /me', `GET /menus/${MENU_ID}`]);
    expect(state().status).toBe('saved');
  });

  it('asks the user on a conflict instead of overwriting either side', async () => {
    linkTo(1, true);
    menu = { ...menu, title: { en: 'Mine' } };
    server.remoteEdit('Theirs');
    await makeSync().init();
    expect(state().status).toBe('conflict');
    expect(state().conflict).toMatchObject({ draftVersion: 2, updatedBy: 'Noa' });
    expect(menu.title.en).toBe('Mine');
    expect(server.draft.title.en).toBe('Theirs');
    edit('Mine 2'); // more edits while in conflict are not pushed
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.draft.title.en).toBe('Theirs');
  });

  it('detects a conflict when saving, and "keep mine" overwrites the cloud', async () => {
    linkTo(1);
    await makeSync().init();
    server.remoteEdit('Theirs');
    edit('Mine');
    await vi.advanceTimersByTimeAsync(150);
    expect(state().status).toBe('conflict');
    await sync.resolveConflict('mine');
    expect(server.draft.title.en).toBe('Mine');
    expect(state()).toMatchObject({ status: 'saved', conflict: null, link: { version: 3, dirty: false } });
  });

  it('"load the cloud version" replaces local changes', async () => {
    linkTo(1, true);
    menu = { ...menu, title: { en: 'Mine' } };
    server.remoteEdit('Theirs');
    await makeSync().init();
    await sync.resolveConflict('theirs');
    expect(menu.title.en).toBe('Theirs');
    expect(state()).toMatchObject({ status: 'saved', conflict: null, link: { version: 2, dirty: false } });
  });

  it('unlinks (keeping the local menu) when the cloud menu was deleted', async () => {
    linkTo(1);
    server.exists = false;
    const before = menu;
    await makeSync().init();
    expect(state()).toMatchObject({ link: null, status: 'local' });
    expect(events).toContain('deletedRemotely');
    expect(menu).toBe(before);
    expect(storage.has(LINK_KEY)).toBe(false);
  });

  it('rejects invalid menus from the server without touching the local one', async () => {
    linkTo(1);
    server.remoteEdit('x');
    server.draft = { nope: true } as unknown as Menu;
    const before = menu;
    await makeSync().init();
    expect(menu).toBe(before);
    expect(state().status).toBe('error');
    expect(events).toContain('invalid');
  });
});

describe('cloud sync — open, detach, sign-out', () => {
  it('opens a cloud menu and links to it', async () => {
    await makeSync().init();
    server.remoteEdit('Cloud menu');
    expect(await sync.open(MENU_ID)).toBe(true);
    expect(menu.title.en).toBe('Cloud menu');
    expect(state().link).toMatchObject({ menuId: MENU_ID, version: 2, dirty: false });
  });

  it('detaches without touching the server and stops syncing', async () => {
    linkTo(1);
    await makeSync().init();
    sync.detach();
    edit('After detach');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    expect(state()).toMatchObject({ link: null, status: 'local' });
    expect(storage.has(LINK_KEY)).toBe(false);
  });

  it('keeps changes pending after the session expires', async () => {
    linkTo(1);
    await makeSync().init();
    server.role = null;
    edit('Expired');
    await vi.advanceTimersByTimeAsync(150);
    expect(state()).toMatchObject({ connection: 'signedOut', status: 'pending', link: { dirty: true } });
  });

  it('signs out', async () => {
    await makeSync().init();
    await sync.signOut();
    expect(state()).toMatchObject({ connection: 'signedOut', user: null });
    expect(server.calls).toContain('POST /auth/sign-out');
  });
});
