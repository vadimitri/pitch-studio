import { useMemo } from "react";
import { computeMetrics, keyMoments, pickFocus, type Metrics } from "../lib/analysis/metrics";
import type { Take } from "../lib/types";

export function analyse(take: Take): Metrics {
  const a = take.analysis;
  return computeMetrics({
    timeline: take.timeline,
    durationSec: take.durationSec,
    targetSec: take.settings.targetSec,
    lang: take.settings.speechLang,
    calib: take.calib,
    words: a.transcript?.words ?? null,
    fillerMode: a.fillerHits ? "detector" : "asr",
    fillerHits: a.fillerHits,
  });
}

export interface Coaching {
  m: Metrics;
  prevM: Metrics | null;
  focus: ReturnType<typeof pickFocus>;
  moments: ReturnType<typeof keyMoments>;
}

export function useCoaching(take: Take, prev: Take | null): Coaching {
  return useMemo(() => {
    const m = analyse(take);
    const prevM = prev ? analyse(prev) : null;
    return { m, prevM, focus: pickFocus(m, prevM, take.settings.focus), moments: keyMoments(m) };
  }, [take, prev]);
}
