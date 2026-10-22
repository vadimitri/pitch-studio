// Tiny observable store for state that lives outside React (camera, analysis engines, settings).
import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  patch(part: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const v = typeof next === "function" ? (next as (p: T) => T)(state) : next;
      if (Object.is(v, state)) return;
      state = v;
      listeners.forEach((l) => l());
    },
    patch(part) {
      state = { ...state, ...part };
      listeners.forEach((l) => l());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

// Persisted in localStorage (per-viewer convenience only; failures are ignored).
export function persisted<T extends object>(key: string, initial: T): Store<T> {
  let start = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw) start = { ...initial, ...JSON.parse(raw) };
  } catch { /* private mode */ }
  const s = createStore<T>(start);
  s.subscribe(() => {
    try { localStorage.setItem(key, JSON.stringify(s.get())); } catch { /* ignore */ }
  });
  return s;
}
