import { useEffect, useRef, type RefObject } from "react";
import { mmss, useT } from "../i18n";
import { asrStatus } from "../lib/asr";
import { useStore } from "../lib/store";
import type { AudienceMode, FocusId, Settings, SpeechLang } from "../lib/types";
import { DemoNote } from "../ui/DemoNote";
import { IconAgain, IconArrowRight, IconPalm } from "../ui/icons";
import { Bar, Button, Kbd, Segmented, Toggle } from "../ui/primitives";
import { engineState, getAudio, getVision } from "./engine";
import { buttonState, hardware } from "./hardware";
import { BRIEF_TARGET, BRIEFS, TARGETS, pick, settingsStore } from "./settings";

/** Positions the persistent camera <video> exactly over a slot element (it must never be re-mounted). */
export function useCamSlot(camRef: RefObject<HTMLVideoElement | null>, slotRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const cam = camRef.current, slot = slotRef.current;
    if (!cam || !slot) return;
    const place = () => {
      const r = slot.getBoundingClientRect();
      Object.assign(cam.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(slot);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      Object.assign(cam.style, { left: "", top: "", width: "", height: "" });
    };
  }, [camRef, slotRef]);
}

function LiveIndicators() {
  const t = useT();
  const level = useRef<HTMLSpanElement>(null);
  const face = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = getAudio()?.voice.get();
      if (level.current && a) level.current.style.transform = `scaleX(${Math.min(1, a.energy * 1.4)})`;
      const v = getVision()?.state.get();
      if (face.current) face.current.dataset.on = v?.face ? "1" : "0";
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="preview-indicators">
      <span className="tag tag-inverse preview-mic"><i className="tag-dot" /> Mic <span className="mic-meter"><span ref={level} className="mic-meter-fill" /></span></span>
      <span ref={face} className="tag tag-inverse preview-face" data-on="0"><i className="tag-dot" /> {t.replay.lanes.gaze}</span>
    </div>
  );
}

function ModelStatus() {
  const t = useT();
  const s = useStore(asrStatus);
  const S = t.studio;
  const label = s.state === "loading" ? S.modelLoading(Math.round(s.progress * 100))
    : s.state === "ready" ? `${S.modelReady}${s.engine ? ` · ${s.engine}` : ""}`
    : s.state === "error" || s.state === "unsupported" ? S.modelError
    : S.modelIdle;
  return (
    <div className="model-status">
      <span className="mono-xs fg-3">{S.speechModel}</span>
      <span className="paragraph-xs">{label}</span>
      {s.state === "loading" && <Bar value={s.progress} color="var(--green)" height={3} />}
    </div>
  );
}

function PairButton() {
  const b = useStore(buttonState);
  if (!b.supported) return null;
  return b.connected
    ? <span className="mono-xs fg-3">● button connected</span>
    : <button className="btn btn-ghost btn-s" style={{ alignSelf: "flex-start", cursor: "pointer" }} onClick={() => void hardware.pair()}>Connect button (Web Serial)</button>;
}

export function Setup({ booth, settings, topic, camRef, onTopic, onStart, onCheck, hasTakes, onBackToReplay }: {
  booth: boolean; settings: Settings; topic?: string;
  camRef: RefObject<HTMLVideoElement | null>; onTopic: (t: string) => void; onStart: () => void; onCheck: () => void;
  hasTakes: boolean; onBackToReplay: () => void;
}) {
  const t = useT();
  const S = t.studio;
  const slot = useRef<HTMLDivElement>(null);
  useCamSlot(camRef, slot);
  const eng = useStore(engineState);
  const set = (p: Partial<Settings>) => settingsStore.patch(p);
  const brief = settings.brief;
  const target = settings.targetSec;

  const topicCard = (brief === "random" || brief === "hotseat") && topic && (
    <div className={`topic-card ${brief}`}>
      <span className="mono-xs">{brief === "random" ? S.topic : S.question}</span>
      <p className="heading-s">{topic}</p>
      <button className="btn btn-ghost btn-s" onClick={() => onTopic(pick(brief === "random" ? t.topics : t.questions, topic))}>
        <IconAgain width={16} height={16} /> {S.reroll}
      </button>
    </div>
  );

  if (booth) {
    return (
      <main className="screen setup setup-booth">
        <div className="setup-booth-preview" ref={slot}><LiveIndicators /></div>
        <div className="setup-booth-copy">
          <h1 className="display-l">{t.booth.idle}</h1>
          <p className="paragraph-xl fg-2">{t.booth.idleSub}</p>
          <div className="booth-briefs">
            {BRIEFS.map((b, i) => (
              <span key={b} className={`booth-brief ${b === brief ? "on" : ""}`}><Kbd>{i + 1}</Kbd> {t.briefs[b].label}</span>
            ))}
          </div>
          {topicCard}
          <div className="row gap-5 booth-meta">
            <span className="label-l tnum">{mmss(target)}</span>
            <span className="paragraph-m fg-2">{t.audience[settings.audience]} · {settings.speechLang.toUpperCase()}</span>
          </div>
          <ModelStatus />
          <PairButton />
        </div>
      </main>
    );
  }

  return (
    <main className="screen setup">
      <section className="setup-left">
        <div className="setup-preview" ref={slot}>
          <LiveIndicators />
          {!eng.visionReady && !eng.visionError && <span className="preview-loading mono-xs">{t.common.loading} MediaPipe…</span>}
        </div>
        <p className="paragraph-s fg-3 setup-note">{S.notSaved}</p>
        <DemoNote k="setup" />
        <ol className="setup-steps">
          {t.landing.steps.map((st, i) => (
            <li key={i}><span className="mono-xs fg-3 tnum">{String(i + 1).padStart(2, "0")}</span><span className="label-s">{st.t}</span><span className="paragraph-xs fg-2">{st.d}</span></li>
          ))}
        </ol>
      </section>

      <section className="setup-right">
        <h1 className="heading-xxl">{S.setupTitle}</h1>
        <fieldset className="field">
          <legend className="mono-xs fg-2">{S.brief}</legend>
          <div className="brief-grid">
            {BRIEFS.map((b, i) => (
              <button key={b} className={`brief ${b === settings.brief ? "on" : ""}`} onClick={() => set({ brief: b, targetSec: BRIEF_TARGET[b] })}>
                <span className="label-m">{t.briefs[b].label}</span>
                <span className="paragraph-xs brief-hint">{t.briefs[b].hint}</span>
                <span className="brief-key mono-xs">{i + 1}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {topicCard}
        <fieldset className="field">
          <legend className="mono-xs fg-2">{S.target}</legend>
          <Segmented size="s" value={settings.targetSec} onChange={(v) => set({ targetSec: v })}
            options={TARGETS.map((x) => ({ value: x, label: <span className="tnum">{mmss(x)}</span> }))} label={S.target} />
        </fieldset>
        <details className="setup-more">
          <summary className="mono-xs fg-2">
            {S.more} <span className="fg-3">· {t.focus[settings.focus]} · {t.audience[settings.audience]} · {settings.speechLang === "de" ? "Deutsch" : "English"}</span>
          </summary>
          <fieldset className="field">
            <legend className="mono-xs fg-2">{S.focusLabel}</legend>
            <Segmented<FocusId> size="s" value={settings.focus} onChange={(v) => set({ focus: v })} label={S.focusLabel}
              options={(["auto", "fillers", "pace", "gaze", "time"] as FocusId[]).map((f) => ({ value: f, label: t.focus[f] }))} />
          </fieldset>
          <div className="field-row">
            <fieldset className="field">
              <legend className="mono-xs fg-2">{S.audienceLabel}</legend>
              <Segmented<AudienceMode> size="s" value={settings.audience} onChange={(v) => set({ audience: v })} label={S.audienceLabel}
                options={(["friendly", "tough", "off"] as AudienceMode[]).map((a) => ({ value: a, label: t.audience[a] }))} />
            </fieldset>
            <fieldset className="field">
              <legend className="mono-xs fg-2">{S.speech}</legend>
              <Segmented<SpeechLang> size="s" value={settings.speechLang} onChange={(v) => set({ speechLang: v })} label={S.speech}
                options={[{ value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} />
            </fieldset>
          </div>
          <div className="field-row toggles">
            <Toggle checked={settings.cue} onChange={(v) => set({ cue: v })} label={S.cue} hint={S.cueHint} />
          </div>
          <button className="btn btn-secondary btn-s check-btn" onClick={onCheck}>{t.check.button} <Kbd>T</Kbd></button>
        </details>
        <div className="start-row">
          <Button variant="record" size="l" className="start-btn" onClick={onStart} iconRight={<IconArrowRight />}>{S.start}</Button>
          <span className="row gap-3 paragraph-s fg-2"><Kbd>{S.startHint}</Kbd>{settings.gestures && <><span>·</span><IconPalm width={18} height={18} /></>}</span>
          <button className={`gesture-toggle ${settings.gestures ? "on" : ""}`} aria-pressed={settings.gestures} onClick={() => set({ gestures: !settings.gestures })} title={S.gesturesHint}>
            <IconPalm width={18} height={18} /> <span>{S.gestures}</span> <span className="mono-xs">{settings.gestures ? S.on : S.off}</span>
          </button>
          {hasTakes && <button className="btn btn-ghost btn-s" onClick={onBackToReplay}>{t.replay.take(eng.takes.at(-1)!.n)} →</button>}
        </div>
        <ModelStatus />
      </section>
    </main>
  );
}
