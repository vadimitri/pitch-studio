// While talking: no self-view. Next to the lens only a small arrow to it, time, the audience and at most one
// opt-in cue word every 25 s (Tanveer et al. 2015: short cues beat continuous meters; Schneider et al. 2016).
import { useEffect, useRef, useState } from "react";
import { mmss, useT } from "../i18n";
import { isFilled, syllables } from "../lib/analysis/lexicon";
import type { Settings } from "../lib/types";
import { Audience, type AudienceInput } from "../ui/Audience";
import { DemoNote } from "../ui/DemoNote";
import { Ring } from "../ui/primitives";
import { getAudio, getVision, type ActiveTake } from "./engine";
import { LensArrow } from "./Countdown";
import type { CamPos } from "./Studio";

const CUE_GAP_MS = 25_000, CUE_SHOW_MS = 3_000;

export function Recording({ camPos, settings, topic, booth, getActive, onStop }: {
  camPos: CamPos; settings: Settings; topic?: string; booth: boolean;
  getActive: () => ActiveTake | null; onStop: (auto: boolean) => void;
}) {
  const t = useT();
  const [el, setEl] = useState(0);
  const [cue, setCue] = useState<string | null>(null);
  const model = useRef({ cam: 0.6, voice: 0.5, lastT: performance.now(), awaySince: 0, lastCue: 0, wrapShown: false });
  const stopped = useRef(false);

  // clock + auto stop + cues
  useEffect(() => {
    const id = setInterval(() => {
      const a = getActive();
      if (!a) return;
      const sec = (performance.now() - a.t0) / 1000;
      setEl(sec);
      if (!stopped.current && sec >= settings.targetSec * 1.2) { stopped.current = true; onStop(true); return; }
      if (!settings.cue) return;
      const now = performance.now(), m = model.current;
      if (now - m.lastCue < CUE_GAP_MS || sec < 8) return;
      const f = settings.focus;
      const want = (k: string) => f === "auto" || f === k;
      let word: string | null = null;
      if (want("time") && !m.wrapShown && sec >= settings.targetSec * 0.9) { word = t.studio.cues.time; m.wrapShown = true; }
      else if (want("gaze") && m.awaySince && now - m.awaySince > 6000) word = t.studio.cues.gaze;
      else {
        const words = a.asr.live.get().words.filter((w) => w.e > sec - 20);
        if (want("fillers") && words.filter((w) => isFilled(w.w, settings.speechLang)).length >= 3) word = t.studio.cues.fillers;
        const recent = words.filter((w) => w.s > sec - 10 && !isFilled(w.w, settings.speechLang));
        const syl = recent.reduce((s, w) => s + syllables(w.w, settings.speechLang), 0);
        if (!word && want("pace") && recent.length > 8 && syl / 10 > 5.2) word = t.studio.cues.pace;
      }
      if (word) {
        m.lastCue = now;
        setCue(word);
        setTimeout(() => setCue(null), CUE_SHOW_MS);
      }
    }, 200);
    return () => clearInterval(id);
  }, [getActive, onStop, settings, t]);

  // engagement for the audience: lens contact and speaking only, so "they drift off when you look away" holds
  const input = (): AudienceInput => {
    const m = model.current, now = performance.now();
    const dt = Math.min(0.2, (now - m.lastT) / 1000);
    m.lastT = now;
    const v = getVision()?.state.get();
    const a = getAudio()?.voice.get();
    const hasVision = !!v?.ready && v.face;
    const camTarget = !v?.ready ? 0.65 : !v.face ? 0.4 : v.look === "camera" ? 1 : v.look === "none" ? 0.5 : 0.05;
    m.cam += (camTarget - m.cam) * (dt / 2.2);
    if (hasVision && v!.look !== "camera" && v!.look !== "none") m.awaySince ||= now; else m.awaySince = 0;
    const speaking = !!a?.speaking;
    m.voice += ((speaking ? 1 : 0) - m.voice) * (dt / (speaking ? 2.5 : 6));
    const engagement = Math.max(0, Math.min(1, 0.1 + 0.65 * m.cam + 0.25 * m.voice));
    return { engagement, speaking };
  };

  const target = settings.targetSec;
  const over = el > target;
  return (
    <main className={`screen recording cam-${camPos} ${booth ? "booth" : ""}`}>
      <div className="near-lens">
        <LensArrow camPos={camPos} />
        <div className="rec-clock">
          <Ring value={Math.min(1, el / target)} size={booth ? 64 : 52} stroke={3} color={over ? "var(--red)" : "var(--white)"} track="var(--gray-20)">
            <i className="rec-dot" />
          </Ring>
          <div className="stack">
            <span className={`label-xl tnum ${over ? "over" : ""}`}>{mmss(el)}</span>
            <span className="mono-xs fg-3 tnum">/ {mmss(target)}</span>
          </div>
        </div>
        {settings.audience !== "off" && <Audience className="rec-audience" mode={settings.audience} count={6} rows={1} seed={9} input={input} />}
        {topic && (
          <div className="rec-topic">
            <span className="mono-xs fg-3">{settings.brief === "hotseat" ? t.studio.question : t.studio.topic}</span>
            <p className="heading-s">{topic}</p>
          </div>
        )}
        <span className={`cue-word heading-l ${cue ? "on" : ""}`} aria-live="polite">{cue}</span>
      </div>
      <div className="rec-bottom">
        <button className="btn btn-secondary btn-m stop-btn" onClick={() => { if (!stopped.current) { stopped.current = true; onStop(false); } }}>
          <span className="stop-square" /> <span>{t.studio.stop}</span>
        </button>
        <span className="paragraph-xs fg-3">{t.studio.stopHint}</span>
      </div>
      <DemoNote k="recording" className="note-corner" />
    </main>
  );
}
