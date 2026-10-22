import { persisted } from "../lib/store";
import type { BriefId, Settings } from "../lib/types";

export const BRIEF_TARGET: Record<BriefId, number> = { free: 120, elevator: 60, startup: 180, explain: 90, random: 60, hotseat: 45 };
export const BRIEFS: BriefId[] = ["free", "elevator", "startup", "explain", "random", "hotseat"];
export const TARGETS = [30, 45, 60, 90, 120, 180, 300];

export const settingsStore = persisted<Settings>("ps.settings", {
  brief: "free",
  targetSec: BRIEF_TARGET.free,
  focus: "auto",
  audience: "friendly",
  speechLang: navigator.language?.toLowerCase().startsWith("de") ? "de" : "en",
  cue: false,
  gestures: false,
});

// "voice" was a focus until 21.10.; stored settings may still have it
if (!["auto", "fillers", "pace", "gaze", "time"].includes(settingsStore.get().focus)) settingsStore.patch({ focus: "auto" });

export const pick = <T,>(a: readonly T[], not?: T): T => {
  const pool = a.length > 1 && not !== undefined ? a.filter((x) => x !== not) : a;
  return pool[Math.floor(Math.random() * pool.length)];
};
