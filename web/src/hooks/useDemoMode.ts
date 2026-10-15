// Whether the demo scanner panel is showing. One switch for the whole app,
// remembered on this computer; ?demo=1 in the URL turns it on.

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'hexabuild.demo';

const URL_FLAG = 'demo';

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    // ?demo=1 switches it on and keeps it on across pages.
    if (new URLSearchParams(window.location.search).get(URL_FLAG) === '1') {
      localStorage.setItem(STORAGE_KEY, '1');
    }

    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return new URLSearchParams(window.location.search).get(URL_FLAG) === '1';
  }
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useDemoMode() {
  const on = useSyncExternalStore(subscribe, () => current);

  const setOn = useCallback((next: boolean) => {
    current = next;

    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Blocked storage: the choice lasts until reload.
    }

    listeners.forEach(listener => listener());
  }, []);

  return { on, setOn };
}
