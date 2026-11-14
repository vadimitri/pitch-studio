import type { Dict } from "../i18n";
import { createStore, persisted } from "../lib/store";
import type { BriefId, HostBriefId, PitchBriefId, Settings } from "../lib/types";

export const BRIEF_TARGET: Record<BriefId, number> = {
  free: 120, elevator: 60, startup: 180, explain: 90, random: 60, hotseat: 45,
  cards: 300, intro: 45, bridge: 20, call: 60, award: 60, mishap: 30,
};
export const BRIEFS: PitchBriefId[] = ["free", "elevator", "startup", "explain", "random", "hotseat"];
export const HOST_BRIEFS: HostBriefId[] = ["cards", "intro", "bridge", "call", "award", "mishap"];
export const TARGETS = [30, 45, 60, 90, 120, 180, 300];
export const HOST_TARGETS = [20, 30, 45, 60, 90, 120, 180, 300, 600, 1200];
export const isHostBrief = (b: BriefId): b is HostBriefId => (HOST_BRIEFS as BriefId[]).includes(b);

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

/** Host mode keeps its own brief so the pitch studio opens as before. */
export const hostStore = persisted<{ brief: HostBriefId; targetSec: number; cards: string }>("ps.host", {
  brief: "cards", targetSec: BRIEF_TARGET.cards, cards: "",
});

/** Clip for "Live call": an object URL for this tab only, never stored. */
export const clipStore = createStore<{ url: string; name: string } | null>(null);
export function setClip(file: File | null) {
  const old = clipStore.get();
  if (old) URL.revokeObjectURL(old.url);
  clipStore.set(file ? { url: URL.createObjectURL(file), name: file.name } : null);
}

/** Surprise prompts per brief (random topic, hot-seat question, host drills); null = brief without one. */
export function promptsFor(t: Dict, brief: BriefId): readonly string[] | null {
  if (brief === "random") return t.topics;
  if (brief === "hotseat") return t.questions;
  if (brief === "intro" || brief === "bridge" || brief === "award" || brief === "mishap") return t.hostPrompts[brief];
  return null;
}

export function promptLabel(t: Dict, brief: BriefId): string {
  if (brief === "intro" || brief === "bridge" || brief === "award" || brief === "mishap") return t.host.promptLabel[brief];
  return brief === "hotseat" ? t.studio.question : t.studio.topic;
}

export const pick = <T,>(a: readonly T[], not?: T): T => {
  const pool = a.length > 1 && not !== undefined ? a.filter((x) => x !== not) : a;
  return pool[Math.floor(Math.random() * pool.length)];
};
