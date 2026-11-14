// While talking: no self-view. Next to the lens only a small arrow to it, time, the audience and at most one
// opt-in cue word every 25 s (Tanveer et al. 2015: short cues beat continuous meters; Schneider et al. 2016).
// Host mode adds what a host has on stage anyway: the cue card (→ / clicker), a muted clip to commentate, and
// once per take an optional surprise mishap (RESEARCH.md › Host mode).
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss, useT } from "../i18n";
import { isFilled, syllables } from "../lib/analysis/lexicon";
import { cardLabel } from "../lib/host";
import type { Settings } from "../lib/types";
import { Audience, type AudienceInput } from "../ui/Audience";
import { DemoNote } from "../ui/DemoNote";
import { Ring } from "../ui/primitives";
import { getAudio, getVision, type ActiveTake } from "./engine";
import { LensArrow } from "./Countdown";
import { pick } from "./settings";
import type { CamPos } from "./Studio";

const CUE_GAP_MS = 25_000, CUE_SHOW_MS = 3_000, MISHAP_SHOW_MS = 6_000;
const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", "n"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "p"]);

/** Card text with **bold** kept; line breaks stay (white-space: pre-wrap). */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</>;
}

export function Recording({ camPos, settings, topic, topicLabel, booth, host = false, clipUrl, getActive, onStop }: {
  camPos: CamPos; settings: Settings; topic?: string; topicLabel?: string; booth: boolean; host?: boolean; clipUrl?: string;
  getActive: () => ActiveTake | null; onStop: (auto: boolean) => void;
}) {
  const t = useT();
  const [el, setEl] = useState(0);
  const [cue, setCue] = useState<string | null>(null);
  const cards = host ? getActive()?.host?.cards?.list ?? null : null;
  const [ci, setCi] = useState(0);
  const [cardT0, setCardT0] = useState(0);
  const ciRef = useRef(0);
  const [mishap, setMishap] = useState<string | null>(null);
  const [plan] = useState(() => (host && settings.surprise && settings.brief !== "mishap" && settings.targetSec >= 30
    ? { at: settings.targetSec * (0.3 + 0.4 * Math.random()), text: pick(t.hostPrompts.mishap) } : null));
  const fired = useRef(false);
  const clipRef = useRef<HTMLVideoElement>(null);
  const showClip = host && settings.brief === "call" && !!clipUrl;
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
      if (plan && !fired.current && sec >= plan.at) {
        fired.current = true;
        a.host = { ...a.host, mishap: { t: Math.round(sec * 10) / 10, text: plan.text } };
        setMishap(plan.text);
        setTimeout(() => setMishap(null), MISHAP_SHOW_MS);
      }
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
  }, [getActive, onStop, settings, t, plan]);

  // cue cards: → / ↓ / PageDown (clickers) next, ← / ↑ / PageUp back; every switch is a mark for the replay
  const go = useCallback((d: number) => {
    const a = getActive();
    const list = a?.host?.cards;
    if (!a || !list) return;
    const n = Math.max(0, Math.min(list.list.length - 1, ciRef.current + d));
    if (n === ciRef.current) return;
    const sec = (performance.now() - a.t0) / 1000;
    list.marks.push({ i: n, t: Math.round(sec * 10) / 10 });
    ciRef.current = n;
    setCi(n);
    setCardT0(sec);
  }, [getActive]);
  useEffect(() => {
    if (!cards) return;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (NEXT_KEYS.has(e.key)) { e.preventDefault(); go(1); }
      else if (PREV_KEYS.has(e.key)) { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [cards, go]);

  // live call: the clip starts with the take; its offset lets the replay play it in sync
  useEffect(() => {
    const v = clipRef.current;
    if (!v || !showClip) return;
    v.currentTime = 0;
    const onPlaying = () => {
      const a = getActive();
      if (a?.host?.clip) a.host.clip.offset = Math.round(((performance.now() - a.t0) / 1000 - v.currentTime) * 100) / 100;
    };
    v.addEventListener("playing", onPlaying, { once: true });
    void v.play().catch(() => {});
    return () => { v.removeEventListener("playing", onPlaying); v.pause(); };
  }, [showClip, getActive]);

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
            <span className="mono-xs fg-3">{topicLabel ?? t.studio.topic}</span>
            <p className="heading-s">{topic}</p>
          </div>
        )}
        <span className={`cue-word heading-l ${cue ? "on" : ""}`} aria-live="polite">{cue}</span>
        {mishap && <div className="rec-mishap" role="alert"><span className="mono-xs">{t.host.mishapMoment}</span><p className="heading-m">{mishap}</p></div>}
        {cards && cards[ci] && (() => {
          const card = cards[ci], nextCard = cards[ci + 1];
          const inCard = el - cardT0;
          return (
            <div className="rec-card" onClick={() => go(1)}>
              <div className="rec-card-head mono-xs fg-3">
                <span className="tnum">{ci + 1} / {cards.length}</span>
                {card.budget != null && <span className={`tnum ${inCard > card.budget ? "over" : ""}`}>{mmss(inCard)} / {mmss(card.budget)}</span>}
              </div>
              {card.title && <p className="heading-m">{card.title}</p>}
              {card.body && <div className="rec-card-body paragraph-l"><Rich text={card.body} /></div>}
              <span className="mono-xs fg-3">{nextCard ? `${t.host.next}: ${cardLabel(nextCard)}` : t.host.last}</span>
              {ci === 0 && <span className="mono-xs fg-3">{t.host.keys}</span>}
            </div>
          );
        })()}
      </div>
      {showClip && <video ref={clipRef} className="rec-clip" src={clipUrl} muted playsInline />}
      <div className="rec-bottom">
        <button className="btn btn-secondary btn-m stop-btn" onClick={() => { if (!stopped.current) { stopped.current = true; onStop(false); } }}>
          <span className="stop-square" /> <span>{t.studio.stop}</span>
        </button>
        <span className="paragraph-xs fg-3">{host ? t.host.escHint : t.studio.stopHint}</span>
      </div>
      <DemoNote k="recording" className="note-corner" />
    </main>
  );
}
