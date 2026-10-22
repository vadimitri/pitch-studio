// Hash routing: works under any base path (GitHub Pages subfolder, localhost booth) without server rewrites.
import { useSyncExternalStore } from "react";

export interface Route {
  path: string; // e.g. "/studio"
  parts: string[]; // ["studio"]
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  // query params may also sit before the hash (?booth=1#/studio); hash params win
  const query = new URLSearchParams(location.search);
  new URLSearchParams(qs).forEach((v, k) => query.set(k, v));
  return { path, parts: path.split("/").filter(Boolean), query };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

export function navigate(to: string) {
  if (location.hash === `#${to}`) return;
  location.hash = to;
}

export const href = (to: string) => `#${to}`;
