/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Cloud sync engine (Phase 2c): keeps the editor's local menu in step with a menu on the MenuAI server.
 *
 * - The local copy (localStorage) stays the source of truth for the editor; the cloud is a mirror.
 * - Local edits mark the link `dirty` (persisted, so nothing is forgotten across reloads) and are
 *   pushed after a short debounce with `If-Match: <version>` (optimistic locking on the server).
 * - A newer server version is loaded automatically only when there are no unsent local changes;
 *   otherwise the user picks a side explicitly (conflict). Nothing is overwritten silently.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { z } from 'zod';
import type { Menu } from '../core/schema';
import { parseMenu } from '../core/schema';
import { api as defaultApi, isNoServer, type ApiResult, type ApiUser } from '../api/client';

export type Connection = 'checking' | 'noServer' | 'signedOut' | 'ready';
/** local = not linked · pending = unsent changes waiting for a connection/sign-in. */
export type SyncStatus = 'local' | 'saving' | 'saved' | 'pending' | 'offline' | 'conflict' | 'readonly' | 'error';
export type SyncEvent = 'remoteLoaded' | 'deletedRemotely' | 'tooLarge' | 'invalid' | 'uploaded' | 'opened';

export interface CloudLink {
  menuId: string;
  slug: string;
  version: number;
  /** Local changes not yet accepted by the server. */
  dirty: boolean;
}

export interface ConflictInfo {
  draftVersion: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface CloudMenuSummary {
  id: string;
  slug: string;
  title: string;
  draftVersion: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface CloudMenuFull extends Omit<CloudMenuSummary, 'title'> {
  draft: unknown;
}

export interface Publication {
  publicSlug: string;
  url: string;
  versionId: string;
  version: number;
  publishedAt: string;
  publishedBy: string | null;
}

export interface PublishedVersion {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: string | null;
  live: boolean;
}

/** Publish state of the linked menu; `null` until loaded. */
export interface History {
  menuId: string;
  publication: Publication | null;
  versions: PublishedVersion[];
}

export type PublishResult =
  | { ok: true; publication: Publication }
  | { ok: false; reason: 'notSynced' | 'changed' | 'forbidden' | 'failed' };

export interface CloudState {
  connection: Connection;
  user: ApiUser | null;
  link: CloudLink | null;
  status: SyncStatus;
  conflict: ConflictInfo | null;
  lastSyncedAt: number | null;
  history: History | null;
}

export interface SyncDeps {
  getMenu: () => Menu;
  /** Replaces the editor menu with a server version (no undo step, must not count as a local edit). */
  loadMenu: (menu: Menu) => void;
  onEvent?: (event: SyncEvent) => void;
  api?: <T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<ApiResult<T>>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  debounceMs?: number;
}

export const LINK_KEY = 'menuai:cloud:v1';
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];
const REFRESH_MIN_MS = 10_000;

const linkSchema = z.object({
  menuId: z.uuid(),
  slug: z.string().max(80),
  version: z.number().int().min(1),
  dirty: z.boolean(),
});

export interface CloudSync {
  store: StoreApi<CloudState>;
  init: () => Promise<void>;
  /** Called on every local edit of the editor menu. */
  localChanged: () => void;
  refresh: (force?: boolean) => Promise<void>;
  flush: () => Promise<void>;
  uploadCurrent: () => Promise<boolean>;
  open: (menuId: string) => Promise<boolean>;
  list: () => Promise<CloudMenuSummary[] | null>;
  resolveConflict: (keep: 'mine' | 'theirs') => Promise<void>;
  /** Loads the publish state and version list of the linked menu. */
  loadHistory: () => Promise<boolean>;
  /** Sends pending edits, then publishes exactly the synced draft. */
  publish: (note?: string) => Promise<PublishResult>;
  unpublish: () => Promise<boolean>;
  /** Copies a published version into the draft (the live menu changes only on the next publish). */
  restore: (versionId: string) => Promise<boolean>;
  detach: () => void;
  signOut: () => Promise<void>;
  dispose: () => void;
}

export function createCloudSync(deps: SyncDeps): CloudSync {
  const api = deps.api ?? defaultApi;
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
  const debounceMs = deps.debounceMs ?? 1500;
  const emit = (e: SyncEvent) => deps.onEvent?.(e);

  const store = createStore<CloudState>(() => ({
    connection: 'checking',
    user: null,
    link: readLink(storage),
    status: 'local',
    conflict: null,
    lastSyncedAt: null,
    history: null,
  }));
  const get = store.getState;
  const set = (patch: Partial<CloudState>) => store.setState(patch);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let retry = 0;
  let lastRefresh = 0;
  let disposed = false;

  function setLink(link: CloudLink | null) {
    if (get().history && get().history!.menuId !== link?.menuId) set({ history: null });
    set({ link });
    try {
      if (link) storage?.setItem(LINK_KEY, JSON.stringify(link));
      else storage?.removeItem(LINK_KEY);
    } catch {
      // Storage blocked: sync still works for this page load.
    }
  }

  const canWrite = () => get().user?.role === 'owner' || get().user?.role === 'editor';

  /** Status to show when nothing is in flight. */
  function idleStatus(): SyncStatus {
    const { link, connection, conflict } = get();
    if (!link) return 'local';
    if (conflict) return 'conflict';
    if (connection === 'ready' && !canWrite()) return 'readonly';
    if (link.dirty) return connection === 'ready' ? 'saving' : 'pending';
    return connection === 'ready' ? 'saved' : 'pending';
  }

  function schedule(ms: number) {
    clearTimeout(timer);
    if (disposed) return;
    timer = setTimeout(() => void flush(), ms);
  }

  function handleAuthLoss(status: number): boolean {
    if (status === 401) {
      set({ connection: 'signedOut', user: null });
      set({ status: idleStatus() });
      return true;
    }
    return false;
  }

  function unlinkDeleted() {
    setLink(null);
    set({ conflict: null, status: 'local' });
    emit('deletedRemotely');
  }

  function applyRemote(remote: CloudMenuFull): boolean {
    const parsed = parseMenu(remote.draft);
    if (!parsed.ok) {
      set({ status: 'error' });
      emit('invalid');
      return false;
    }
    deps.loadMenu(parsed.menu);
    setLink({ menuId: remote.id, slug: remote.slug, version: remote.draftVersion, dirty: false });
    set({ conflict: null, status: 'saved', lastSyncedAt: Date.now() });
    return true;
  }

  async function push(): Promise<void> {
    const link = get().link;
    if (!link || !link.dirty || get().conflict || get().connection !== 'ready') {
      set({ status: idleStatus() });
      return;
    }
    if (!canWrite()) {
      set({ status: 'readonly' });
      return;
    }
    const sent = deps.getMenu();
    set({ status: 'saving' });
    const r = await api<{ menu: { draftVersion: number } }>(`/menus/${link.menuId}`, {
      method: 'PUT',
      body: sent,
      headers: { 'if-match': `"${link.version}"` },
    });
    const current = get().link;
    // Detached, switched, or replaced meanwhile (e.g. a restore loaded a newer version): this answer is stale.
    if (!current || current.menuId !== link.menuId || current.version !== link.version) return;
    if (r.ok) {
      retry = 0;
      // Edits made while the request was in flight stay dirty and go out in the next round.
      const stillDirty = deps.getMenu() !== sent;
      setLink({ ...current, version: r.data.menu.draftVersion, dirty: stillDirty });
      set({ lastSyncedAt: Date.now(), status: idleStatus() });
      if (stillDirty) schedule(debounceMs);
      return;
    }
    if (handleAuthLoss(r.status)) return;
    if (r.status === 409) {
      const b = r.body ?? {};
      set({
        conflict: {
          draftVersion: typeof b.draftVersion === 'number' ? b.draftVersion : current.version,
          updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : null,
          updatedBy: typeof b.updatedBy === 'string' ? b.updatedBy : null,
        },
        status: 'conflict',
      });
      return;
    }
    if (r.status === 404 && r.error === 'not_found') return unlinkDeleted();
    if (r.status === 403) return set({ status: 'readonly' });
    if (r.status === 413) {
      set({ status: 'error' });
      return emit('tooLarge');
    }
    if (r.status === 400) {
      set({ status: 'error' });
      return emit('invalid');
    }
    // Network or server trouble: keep the changes (dirty) and retry with backoff.
    set({ status: 'offline' });
    schedule(RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)]!);
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    if (inFlight) return inFlight.then(() => flush());
    inFlight = push().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function refresh(force = false): Promise<void> {
    const link = get().link;
    if (!link || get().connection !== 'ready' || get().conflict || inFlight) return;
    if (!force && Date.now() - lastRefresh < REFRESH_MIN_MS) return;
    lastRefresh = Date.now();
    const r = await api<{ menu: CloudMenuFull }>(`/menus/${link.menuId}`, { headers: { 'if-none-match': `"${link.version}"` } });
    const current = get().link;
    if (!current || current.menuId !== link.menuId) return;
    if (r.ok && r.status === 304) {
      if (current.dirty) return flush();
      set({ status: idleStatus(), lastSyncedAt: Date.now() });
      return;
    }
    if (r.ok) {
      const remote = r.data.menu;
      if (remote.draftVersion === current.version) {
        if (current.dirty) return flush();
        set({ status: idleStatus() });
        return;
      }
      if (!current.dirty) {
        if (applyRemote(remote)) emit('remoteLoaded');
        return;
      }
      set({
        conflict: { draftVersion: remote.draftVersion, updatedAt: remote.updatedAt, updatedBy: remote.updatedBy },
        status: 'conflict',
      });
      return;
    }
    if (handleAuthLoss(r.status)) return;
    if (r.status === 404 && r.error === 'not_found') return unlinkDeleted();
    set({ status: 'offline' });
  }

  async function init(): Promise<void> {
    set({ connection: 'checking' });
    const r = await api<{ user: ApiUser }>('/me');
    if (r.ok) set({ connection: 'ready', user: r.data.user });
    else if (r.status === 401) set({ connection: 'signedOut', user: null });
    else set({ connection: isNoServer(r.status, r.error) ? 'noServer' : 'signedOut', user: null });
    set({ status: idleStatus() });
    if (get().connection === 'ready') await refresh(true);
  }

  function localChanged() {
    const link = get().link;
    if (!link) return;
    // A signed-in viewer can never send edits: keep them local instead of marking the menu "unsent",
    // which would turn every newer team version into a conflict.
    if (get().connection === 'ready' && !canWrite()) return set({ status: 'readonly' });
    if (!link.dirty) setLink({ ...link, dirty: true });
    if (get().conflict) return;
    if (get().connection !== 'ready') return set({ status: 'pending' });
    set({ status: 'saving' });
    schedule(debounceMs);
  }

  async function uploadCurrent(): Promise<boolean> {
    if (get().connection !== 'ready' || !canWrite()) return false;
    const sent = deps.getMenu();
    set({ status: 'saving' });
    const r = await api<{ menu: CloudMenuFull }>('/menus', { method: 'POST', body: { menu: sent } });
    if (!r.ok) {
      if (handleAuthLoss(r.status)) return false;
      set({ status: get().link ? idleStatus() : 'local' });
      if (r.status === 413) emit('tooLarge');
      else if (r.status === 400) emit('invalid');
      else set({ status: 'error' });
      return false;
    }
    const m = r.data.menu;
    const dirty = deps.getMenu() !== sent;
    setLink({ menuId: m.id, slug: m.slug, version: m.draftVersion, dirty });
    set({ conflict: null, lastSyncedAt: Date.now(), status: idleStatus() });
    if (dirty) schedule(debounceMs);
    emit('uploaded');
    return true;
  }

  async function open(menuId: string): Promise<boolean> {
    const r = await api<{ menu: CloudMenuFull }>(`/menus/${menuId}`);
    if (!r.ok) {
      handleAuthLoss(r.status);
      return false;
    }
    clearTimeout(timer);
    const ok = applyRemote(r.data.menu);
    if (ok) emit('opened');
    return ok;
  }

  async function list(): Promise<CloudMenuSummary[] | null> {
    const r = await api<{ menus: CloudMenuSummary[] }>('/menus');
    if (r.ok) return r.data.menus;
    handleAuthLoss(r.status);
    return null;
  }

  async function resolveConflict(keep: 'mine' | 'theirs'): Promise<void> {
    const { link, conflict } = get();
    if (!link || !conflict) return;
    if (keep === 'theirs') {
      const r = await api<{ menu: CloudMenuFull }>(`/menus/${link.menuId}`);
      if (r.ok) {
        if (applyRemote(r.data.menu)) emit('remoteLoaded');
      } else if (!handleAuthLoss(r.status)) {
        if (r.status === 404 && r.error === 'not_found') unlinkDeleted();
        else set({ status: 'offline' });
      }
      return;
    }
    // Keep mine: overwrite the version we were told about. If yet another save landed since,
    // the server answers 409 again and the user is asked again — still nothing lost silently.
    setLink({ ...link, version: conflict.draftVersion, dirty: true });
    set({ conflict: null });
    await flush();
  }

  async function loadHistory(): Promise<boolean> {
    const link = get().link;
    if (!link || get().connection !== 'ready') return false;
    const r = await api<{ publication: Publication | null; versions: PublishedVersion[] }>(`/menus/${link.menuId}/versions`);
    if (get().link?.menuId !== link.menuId) return false;
    if (r.ok) {
      set({ history: { menuId: link.menuId, publication: r.data.publication, versions: r.data.versions } });
      return true;
    }
    if (handleAuthLoss(r.status)) return false;
    if (r.status === 404 && r.error === 'not_found') unlinkDeleted();
    return false;
  }

  async function publish(note = ''): Promise<PublishResult> {
    await flush();
    const link = get().link;
    if (!link || link.dirty || get().conflict || get().connection !== 'ready') return { ok: false, reason: 'notSynced' };
    if (!canWrite()) return { ok: false, reason: 'forbidden' };
    const r = await api<{ publication: Publication; version: number }>(`/menus/${link.menuId}/publish`, {
      method: 'POST',
      body: note ? { note } : {},
      headers: { 'if-match': `"${link.version}"` },
    });
    if (r.ok) {
      await loadHistory();
      return { ok: true, publication: r.data.publication };
    }
    if (handleAuthLoss(r.status)) return { ok: false, reason: 'notSynced' };
    if (r.status === 409) {
      // Another device saved meanwhile: pull it in (or raise a conflict) so the user sees what would go live.
      await refresh(true);
      return { ok: false, reason: 'changed' };
    }
    if (r.status === 403) return { ok: false, reason: 'forbidden' };
    if (r.status === 404 && r.error === 'not_found') unlinkDeleted();
    return { ok: false, reason: 'failed' };
  }

  async function unpublish(): Promise<boolean> {
    const link = get().link;
    if (!link) return false;
    const r = await api(`/menus/${link.menuId}/unpublish`, { method: 'POST' });
    if (!r.ok) {
      handleAuthLoss(r.status);
      return false;
    }
    await loadHistory();
    return true;
  }

  async function restore(versionId: string): Promise<boolean> {
    const link = get().link;
    if (!link) return false;
    clearTimeout(timer);
    const r = await api<{ menu: CloudMenuFull }>(`/menus/${link.menuId}/restore/${versionId}`, { method: 'POST' });
    if (!r.ok) {
      handleAuthLoss(r.status);
      return false;
    }
    if (!applyRemote(r.data.menu)) return false;
    await loadHistory();
    return true;
  }

  function detach() {
    clearTimeout(timer);
    setLink(null);
    set({ conflict: null, status: 'local' });
  }

  async function signOut(): Promise<void> {
    await api('/auth/sign-out', { method: 'POST' });
    clearTimeout(timer);
    set({ connection: 'signedOut', user: null });
    set({ status: idleStatus() });
  }

  function dispose() {
    disposed = true;
    clearTimeout(timer);
  }

  return { store, init, localChanged, refresh, flush, uploadCurrent, open, list, resolveConflict, loadHistory, publish, unpublish, restore, detach, signOut, dispose };
}

function readLink(storage: SyncDeps['storage']): CloudLink | null {
  try {
    const raw = storage?.getItem(LINK_KEY);
    if (!raw) return null;
    const parsed = linkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
