/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useSyncExternalStore } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function read(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = hash.split('?');
  return { path: path.replace(/\/+$/, '') || '/', params: new URLSearchParams(query) };
}

let cached = typeof window === 'undefined' ? { path: '/', params: new URLSearchParams() } : read();
let cachedHash = typeof window === 'undefined' ? '' : window.location.hash;

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

function snapshot(): Route {
  if (window.location.hash !== cachedHash) {
    cachedHash = window.location.hash;
    cached = read();
  }
  return cached;
}

/** Minimal hash router: works on any static host without server rewrites. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}
