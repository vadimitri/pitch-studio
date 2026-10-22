// The studio: one persistent camera <video> (vision reads it), one persistent replay <video> (blessed for
// sound in the first user gesture), and a phase machine: permission → setup → calibrate (first take) →
// countdown → recording → predict → replay ⇄ compare.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { navigate } from "../lib/router";
import { useStore } from "../lib/store";
import { localStore } from "../lib/takes";
import type { Prediction, Take } from "../lib/types";
import type { GestureName } from "../lib/vision";
import { Calibrate } from "./Calibrate";
import { Compare } from "./Compare";
import { Countdown } from "./Countdown";
import { GazeCheck } from "./GazeCheck";
import { GestureHud } from "./GestureHud";
import {
  beginTake, endTake, engineState, getStream, getVision, removeTake, requestMedia, resetSession, startVision, updateTake, watchdog, type ActiveTake,
} from "./engine";
import { hardware } from "./hardware";
import { bless, revokeBlob, tick } from "./media-helpers";
import { Permission } from "./Permission";
import { Predict } from "./Predict";
import { Recording } from "./Recording";
import { Replay } from "./Replay";
import { pick, settingsStore } from "./settings";
import { Setup } from "./Setup";
import { ShareSheet } from "./ShareSheet";
import { StudioBar } from "./StudioBar";
import { VisionDebugMount } from "./VisionDebugMount";
import "../styles/studio.css";

/** Current replay frame as a small JPEG for the takes list. */
function posterFrom(v: HTMLVideoElement): string | undefined {
  try {
    if (!v.videoWidth) return undefined;
    const c = document.createElement("canvas");
    c.width = 320; c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } catch { return undefined; }
}

export type Phase = "permission" | "setup" | "calibrate" | "countdown" | "recording" | "predict" | "replay" | "compare" | "check";
export type CamPos = "top" | "left" | "right";

const BUTTON_KEYS = new Set([" ", "Enter", "F13"]);
const LONG_MS = 900;
const BOOTH_IDLE_MS = 75_000;

export default function Studio({ query }: { query: URLSearchParams }) {
  const t = useT();
  const booth = query.get("booth") === "1";
  const camPos: CamPos = (["left", "right", "top"].includes(query.get("cam") ?? "") ? query.get("cam") : "top") as CamPos;
  const debug = query.get("debug") === "1";
  const eng = useStore(engineState);
  const settings = useStore(settingsStore);
  const [phase, setPhase] = useState<Phase>("permission");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | undefined>();
  const [toast, setToast] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Take | null>(null);
  const [shareReady, setShareReady] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const camRef = useRef<HTMLVideoElement>(null);
  const replayEl = useMemo(() => {
    const v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    v.className = "player-video";
    return v;
  }, []);
  const active = useRef<ActiveTake | null>(null);
  const pendingPrediction = useRef<Prediction | null | undefined>(undefined);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sharingRef = useRef(sharing);
  sharingRef.current = sharing;

  const effective = settings;
  const current = eng.takes.find((x) => x.id === currentId) ?? null;
  const prev = current ? [...eng.takes].reverse().find((x) => x.n < current.n) ?? null : null;
  const gesturesOn = booth || settings.gestures;

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((x) => (x === msg ? null : x)), 3200);
  }, []);

  // ── media ──
  const attach = useCallback(async () => {
    const ok = await requestMedia(booth);
    if (!ok || !camRef.current) return;
    const v = camRef.current;
    v.srcObject = getStream();
    v.muted = true;
    await v.play().catch(() => {});
    void startVision(v);
    setPhase("setup");
  }, [booth]);

  useEffect(() => {
    if (getStream()) { void attach(); return; }
    if (booth) { void attach(); return; }
    navigator.permissions?.query({ name: "camera" as PermissionName }).then((p) => { if (p.state === "granted") void attach(); }).catch(() => {});
  }, [attach, booth]);

  useEffect(() => (camRef.current ? watchdog(camRef.current) : undefined), []);

  // topic for random / hot-seat briefs
  useEffect(() => {
    if (effective.brief === "random") setTopic((x) => (x && t.topics.includes(x) ? x : pick(t.topics)));
    else if (effective.brief === "hotseat") setTopic((x) => (x && t.questions.includes(x) ? x : pick(t.questions)));
    else setTopic(undefined);
  }, [effective.brief, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── flow ──
  const start = useCallback(() => {
    if (phaseRef.current !== "setup" && phaseRef.current !== "replay" && phaseRef.current !== "compare") return;
    bless(replayEl);
    replayEl.pause();
    tick(660, 0.06);
    const v = getVision();
    setPhase(v && !v.calibration() ? "calibrate" : "countdown");
  }, [replayEl]);

  const startRecording = useCallback(async () => {
    try {
      active.current = await beginTake(effective, topic);
      tick(1320, 0.12, 0.05);
      setPhase("recording");
    } catch (e) {
      console.error(e);
      say(t.errors.record);
      setPhase("setup");
    }
  }, [effective, topic, say, t]);

  const stop = useCallback(async (discard = false) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    tick(440, 0.12, 0.05);
    pendingPrediction.current = undefined;
    setCurrentId(null);
    setPhase(discard ? "setup" : "predict");
    const take = await endTake(a, discard);
    if (!take) {
      if (discard) say(t.studio.discarded);
      setPhase("setup");
      return;
    }
    setCurrentId(take.id); // the effect below moves on if the person already answered
  }, [say, t]);

  const predict = useCallback((p: Prediction | null) => {
    if (phaseRef.current !== "predict") return;
    pendingPrediction.current = p;
    if (currentId) {
      if (p) updateTake(currentId, { prediction: p });
      setPhase("replay");
    }
  }, [currentId]);

  // answered while the take was still being finalised
  useEffect(() => {
    if (phase === "predict" && currentId && pendingPrediction.current !== undefined) {
      if (pendingPrediction.current) updateTake(currentId, { prediction: pendingPrediction.current });
      setPhase("replay");
    }
  }, [phase, currentId]);

  const again = useCallback(() => {
    if (effective.brief === "random") setTopic(pick(t.topics, topic)); // hot seat keeps its question
    start();
  }, [effective.brief, start, t.topics, topic]);

  // Share = keep the take in this browser (review page + link), then show the share sheet.
  const share = useCallback(async () => {
    if (!current) return;
    // the sheet opens at once; Safari needs a moment to copy the video into storage, the "open" button waits for it
    const saved: Take = { ...current, saved: true, poster: current.saved ? undefined : posterFrom(replayEl) };
    setSharing(saved);
    setShareReady(current.saved);
    if (current.saved) return;
    try {
      await localStore.put(saved);
      updateTake(current.id, { saved: true });
      setShareReady(true);
    } catch (e) {
      console.error(e);
      setSharing(null);
      say(t.errors.storage);
    }
  }, [current, say, t]);

  const del = useCallback(() => {
    if (!current) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      say(t.replay.deleteConfirm);
      window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    setDeleteArmed(false);
    replayEl.pause();
    replayEl.removeAttribute("src");
    revokeBlob(current.video);
    if (current.saved) void localStore.remove(current.id);
    removeTake(current.id);
    const rest = engineState.get().takes;
    if (rest.length) setCurrentId(rest[rest.length - 1].id);
    else { setCurrentId(null); setPhase("setup"); }
  }, [current, deleteArmed, replayEl, say, t]);

  const done = useCallback(() => {
    replayEl.pause();
    if (booth) {
      for (const tk of engineState.get().takes) revokeBlob(tk.video);
      resetSession();
      setCurrentId(null);
      say(t.booth.sessionEnd);
    }
    setPhase("setup");
  }, [booth, replayEl, say, t]);

  const compare = useCallback(() => { if (prev) setPhase("compare"); else say(t.replay.compareNone); }, [prev, say, t]);

  // ── keyboard: the red button is Space / Enter / F13; long press = discard / end ──
  const actions = useRef({ start, stop, predict, again, share, del, done, compare });
  actions.current = { start, stop, predict, again, share, del, done, compare };
  useEffect(() => {
    let downAt = 0, longFired = false, longTimer = 0;
    const isField = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const onLong = () => {
      longFired = true;
      const p = phaseRef.current, A = actions.current;
      if (p === "recording") void A.stop(true);
      else if (booth && (p === "replay" || p === "compare")) A.done();
    };
    const onPress = () => {
      const p = phaseRef.current, A = actions.current;
      if (p === "setup") A.start();
      else if (p === "calibrate") setPhase("countdown");
      else if (p === "recording") void A.stop(false);
      else if (p === "predict") A.predict(null);
      else if (p === "replay" && booth) A.again();
      else if (p === "compare") setPhase("replay");
    };
    const down = (e: KeyboardEvent) => {
      if (isField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (sharingRef.current) { if (e.key === "Escape") { e.preventDefault(); setSharing(null); } return; }
      const p = phaseRef.current, A = actions.current;
      const isButton = BUTTON_KEYS.has(e.key) && !(p === "replay" && !booth && e.key === " ");
      if (isButton) {
        e.preventDefault();
        if (e.repeat) return;
        if (p === "replay" && !booth && e.key === "Enter") { A.again(); return; }
        downAt = performance.now();
        longFired = false;
        clearTimeout(longTimer);
        longTimer = window.setTimeout(onLong, LONG_MS);
        return;
      }
      if (e.key === "Escape") {
        if (p === "recording") void A.stop(true);
        else if (p === "countdown" || p === "calibrate") setPhase("setup");
        else if (p === "compare") setPhase("replay");
        else if (p === "replay") A.done();
        else if (p === "check") setPhase("setup");
        return;
      }
      if (p === "predict") {
        if (e.key === "ArrowUp" || e.key === "1") A.predict("good");
        if (e.key === "ArrowRight" || e.key === "2") A.predict("ok");
        if (e.key === "ArrowDown" || e.key === "3") A.predict("bad");
        return;
      }
      if (p === "replay") {
        const k = e.key.toLowerCase();
        if (k === "r") A.again();
        else if (k === "c") A.compare();
        else if (k === "s" || k === "k") void A.share();
        else if (k === "d" || e.key === "Delete" || e.key === "Backspace") A.del();
        return;
      }
      if (p === "setup" && e.key.toLowerCase() === "t") { setPhase("check"); return; }
      if (p === "setup" && /^[1-6]$/.test(e.key)) {
        const ids = ["free", "elevator", "startup", "explain", "random", "hotseat"] as const;
        const brief = ids[Number(e.key) - 1];
        settingsStore.patch({ brief });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!BUTTON_KEYS.has(e.key) || !downAt) return;
      clearTimeout(longTimer);
      const held = performance.now() - downAt;
      downAt = 0;
      if (!longFired && held < LONG_MS) onPress();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); clearTimeout(longTimer); };
  }, [booth]);

  // ── vision load: full speed only where gaze matters, a trickle elsewhere, nothing once you leave the studio ──
  useEffect(() => {
    const v = eng.visionReady ? getVision() : null;
    v?.setOptions({ mode: phase === "calibrate" || phase === "countdown" || phase === "recording" || phase === "check" ? "full" : "low" });
  }, [eng.visionReady, phase]);
  useEffect(() => () => getVision()?.setOptions({ mode: "off" }), []);

  // ── gestures (labels for the live feedback: GestureHud.gestureLabels) ──
  useEffect(() => {
    const v = eng.visionReady ? getVision() : null;
    if (!v) return;
    v.setOptions({ gestures: gesturesOn });
    if (!gesturesOn) return;
    return v.onGesture((name: GestureName) => {
      const p = phaseRef.current, A = actions.current;
      if (p === "setup" && name === "Open_Palm") A.start();
      else if (p === "predict") {
        if (name === "Thumb_Up") A.predict("good");
        else if (name === "Open_Palm") A.predict("ok");
        else if (name === "Thumb_Down") A.predict("bad");
      } else if (p === "replay") {
        if (name === "Open_Palm") A.again();
        else if (name === "Thumb_Up") void A.share();
        else if (name === "Victory") A.compare();
        else if (name === "Thumb_Down") A.del();
      } else if (p === "compare" && (name === "Victory" || name === "Open_Palm")) setPhase("replay");
    });
  }, [eng.visionReady, gesturesOn]);

  // ── booth: nobody there for a while → session ends, unsaved takes are deleted ──
  useEffect(() => {
    if (!booth || !eng.visionReady) return;
    let lastFace = performance.now();
    const id = window.setInterval(() => {
      const v = getVision();
      if (v?.state.get().face) lastFace = performance.now();
      const p = phaseRef.current;
      if ((p === "setup" || p === "replay" || p === "compare") && performance.now() - lastFace > BOOTH_IDLE_MS && engineState.get().takes.length) {
        actions.current.done();
        lastFace = performance.now();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [booth, eng.visionReady]);

  // leaving the studio stops nothing (camera stays warm for a quick return) but pauses replay
  useEffect(() => () => replayEl.pause(), [replayEl]);

  // booth button LED ring follows the phase (countdown + recording progress are driven from their screens)
  useEffect(() => { if (booth) void hardware.auto(); }, [booth]);
  useEffect(() => {
    if (!booth) return;
    const map: Partial<Record<Phase, string>> = { setup: "idle", calibrate: "calib", predict: "proc", replay: "replay", compare: "replay", permission: "off" };
    if (map[phase]) hardware.led(map[phase]!);
    if (phase !== "recording" && phase !== "countdown") return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      if (phase === "countdown") hardware.led("count", Math.max(1, 3 - Math.floor(el)));
      else hardware.led("rec", Math.min(1, el / effective.targetSec).toFixed(2));
    }, 200);
    return () => clearInterval(id);
  }, [booth, phase, effective.targetSec]);
  useEffect(() => { if (booth && sharing) hardware.led("ok"); }, [booth, sharing]);
  useEffect(() => { if (phase !== "replay") setSharing(null); }, [phase]);

  const showBar = phase === "setup" || phase === "replay" || phase === "compare" || phase === "permission";

  return (
    <div className={`studio theme-dark phase-${phase} cam-${camPos} ${booth ? "booth" : ""}`}>
      <video ref={camRef} className={`cam ${phase === "setup" ? "cam-preview" : "cam-hidden"}`} muted playsInline />
      {showBar && <StudioBar booth={booth} takes={eng.takes} currentId={currentId} phase={phase}
        onSelect={(id) => { setCurrentId(id); setPhase("replay"); }} onExit={() => { replayEl.pause(); navigate("/"); }} />}

      {phase === "permission" && <Permission state={eng.permission} onAllow={attach} />}
      {phase === "setup" && (
        <Setup booth={booth} settings={settings} topic={topic} camRef={camRef}
          onTopic={(x) => setTopic(x)} onStart={start}
          onCheck={() => setPhase("check")} hasTakes={eng.takes.length > 0} onBackToReplay={() => { if (eng.takes.length) { setCurrentId(eng.takes.at(-1)!.id); setPhase("replay"); } }} />
      )}
      {phase === "check" && <GazeCheck camPos={camPos} onDone={() => setPhase("setup")} />}
      {phase === "calibrate" && <Calibrate camPos={camPos} onDone={(ok) => { if (!ok) say(t.studio.calibFail); setPhase("countdown"); }} />}
      {phase === "countdown" && <Countdown camPos={camPos} audience={effective.audience} topic={topic} isQuestion={effective.brief === "hotseat"} onDone={startRecording} />}
      {phase === "recording" && (
        <Recording camPos={camPos} settings={effective} topic={topic} booth={booth}
          getActive={() => active.current} onStop={(auto) => { if (auto) say(t.studio.autoStop); void stop(false); }} />
      )}
      {phase === "predict" && <Predict onPick={predict} gestures={gesturesOn} />}
      {phase === "replay" && current && (
        <Replay take={current} prev={prev} video={replayEl} booth={booth} gestures={gesturesOn} deleteArmed={deleteArmed}
          onAgain={again} onCompare={compare} onShare={() => void share()} onDelete={del} onSetup={done} />
      )}
      {phase === "compare" && current && prev && <Compare a={prev} b={current} onBack={() => setPhase("replay")} />}

      {sharing && <ShareSheet take={sharing} ready={shareReady} onClose={() => setSharing(null)} />}
      {gesturesOn && (phase === "setup" || phase === "predict" || phase === "replay" || phase === "compare") && !sharing && <GestureHud phase={phase} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {debug && camRef.current && <VisionDebugMount video={camRef.current} />}
    </div>
  );
}
