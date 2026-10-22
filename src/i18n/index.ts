import { de } from "./de";
import { en, type Dict } from "./en";
import { persisted, useStore } from "../lib/store";
import type { UiLang } from "../lib/types";

const dicts: Record<UiLang, Dict> = { en, de };
const initial: UiLang = navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
export const uiPrefs = persisted<{ lang: UiLang }>("ps.ui", { lang: initial });

export function useT(): Dict & { lang: UiLang } {
  const { lang } = useStore(uiPrefs);
  return Object.assign(Object.create(dicts[lang]), { lang });
}

export const setLang = (lang: UiLang) => {
  uiPrefs.patch({ lang });
  document.documentElement.lang = lang;
};
document.documentElement.lang = uiPrefs.get().lang;

export const fmtNum = (lang: UiLang, x: number | null | undefined, d = 1) =>
  x == null || Number.isNaN(x) ? "–" : x.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: d });

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
export type { Dict };
