// Transcript that follows playback: current word highlighted, fillers marked, pauses shown; click to seek.
import { useEffect, useMemo, useRef } from "react";
import { fmtNum, useT } from "../i18n";
import { isFilled } from "../lib/analysis/lexicon";
import type { Metrics } from "../lib/analysis/metrics";
import { asrStatus } from "../lib/asr";
import { useStore, type Store } from "../lib/store";
import type { TakeAnalysis } from "../lib/types";

type Tok = { kind: "w"; s: number; e: number; text: string; filler: boolean } | { kind: "p"; s: number; dur: number; hes: boolean } | { kind: "f"; s: number; text: string };

export function Transcript({ analysis, metrics, time, onSeek, lang }: {
  analysis: TakeAnalysis; metrics: Metrics; time: Store<number>; onSeek: (t: number) => void; lang: "en" | "de";
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const words = analysis.transcript?.words ?? null;
  const toks = useMemo<Tok[]>(() => {
    if (!words) return [];
    const out: Tok[] = [];
    const detected = (metrics.speech?.fillers.items ?? []).filter((f) => f.src !== "asr");
    const label = (k: "uh" | "um" | "hm") => (lang === "de" ? (k === "um" ? "ähm" : k === "hm" ? "hm" : "äh") : k);
    let di = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      while (di < detected.length && detected[di].t < w.s) {
        out.push({ kind: "f", s: detected[di].t, text: label(detected[di].kind) });
        di++;
      }
      if (i > 0) {
        const gap = w.s - words[i - 1].e;
        if (gap >= 0.6) out.push({ kind: "p", s: words[i - 1].e, dur: gap, hes: !/[.!?:]$/.test(words[i - 1].w.trim()) });
      }
      out.push({ kind: "w", s: w.s, e: w.e, text: w.w, filler: isFilled(w.w, lang) });
    }
    for (; di < detected.length; di++) out.push({ kind: "f", s: detected[di].t, text: label(detected[di].kind) });
    return out;
  }, [words, metrics, lang]);

  // highlight the current word imperatively
  useEffect(() => {
    const el = box.current;
    if (!el || !toks.length) return;
    const spans = Array.from(el.querySelectorAll<HTMLElement>("[data-s]"));
    const starts = spans.map((s) => Number(s.dataset.s));
    let cur: HTMLElement | null = null;
    let userScrollUntil = 0;
    const onWheel = () => (userScrollUntil = performance.now() + 4000);
    el.addEventListener("wheel", onWheel, { passive: true });
    const un = time.subscribe(() => {
      const ct = time.get();
      let lo = 0, hi = starts.length - 1, idx = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= ct) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      const next = idx >= 0 ? spans[idx] : null;
      if (next === cur) return;
      cur?.classList.remove("now");
      next?.classList.add("now");
      cur = next;
      if (next && performance.now() > userScrollUntil) {
        const top = next.offsetTop - el.offsetTop;
        if (top < el.scrollTop + 20 || top > el.scrollTop + el.clientHeight - 40) el.scrollTo({ top: top - el.clientHeight / 3, behavior: "smooth" });
      }
    });
    return () => { un(); el.removeEventListener("wheel", onWheel); };
  }, [toks, time]);

  const engine = analysis.transcript?.engine;
  const asr = useStore(asrStatus);
  const downloading = analysis.status === "transcribing" && asr.state === "loading";
  return (
    <section className="transcript">
      <div className="row gap-3 transcript-head">
        <h2 className="mono-xs fg-2">{t.replay.transcript}</h2>
        {analysis.status === "transcribing" && (
          <span className="mono-xs pending-dot">
            {downloading ? `${t.studio.speechModel}: ${t.studio.modelLoading(Math.round(asr.progress * 100))}` : t.replay.transcriptPending}
          </span>
        )}
      </div>
      <div className="transcript-body paragraph-m" ref={box}>
        {analysis.status === "transcribing" && !words && <TranscriptSkeleton />}
        {analysis.status !== "transcribing" && !words && <p className="fg-3">{t.replay.transcriptNone}</p>}
        {toks.map((k, i) =>
          k.kind === "w" ? (
            <span key={i} data-s={k.s} className={`tw ${k.filler ? "tw-filler" : ""}`} onClick={() => onSeek(Math.max(0, k.s - 0.2))}>{k.text} </span>
          ) : k.kind === "f" ? (
            <span key={i} data-s={k.s} className="tw tw-filler tw-detected" onClick={() => onSeek(Math.max(0, k.s - 0.3))} title={t.replay.metric.fillersEst}>{k.text} </span>
          ) : (
            <span key={i} className={`tp ${k.hes ? "tp-hes" : ""}`} onClick={() => onSeek(k.s)}>{fmtNum(t.lang, k.dur, 1)} s </span>
          ),
        )}
      </div>
      {engine && (
        <p className="mono-xs fg-3 transcript-foot">
          {engine}
          {analysis.fillerHits && <> · <a href="https://huggingface.co/desert-ant-labs/uhm" target="_blank" rel="noreferrer">Powered by Desert Ant Labs</a></>}
        </p>
      )}
    </section>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      {[92, 76, 84, 60].map((w, i) => <span key={i} style={{ width: `${w}%` }} />)}
    </div>
  );
}
