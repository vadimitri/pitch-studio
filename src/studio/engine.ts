// Studio session engine, outside React: camera + mic, vision, recorder, the 10 Hz take timeline,
// speech recognition and the in-memory session takes.
import { beginTakeAsr, preloadAsr, type TakeAsr } from "../lib/asr";
import { createAudioEngine, type AudioEngine } from "../lib/media/audio";
import { startRecording, type Recording } from "../lib/media/recorder";
import { remux } from "../lib/media/remux";
import { createStore } from "../lib/store";
import { uid } from "../lib/takes";
import type { Settings, Take, Timeline } from "../lib/types";
import type { Vision } from "../lib/vision";

export type PermissionState = "unknown" | "asking" | "granted" | "denied" | "insecure" | "nodevice" | "unsupported";

export interface EngineState {
  permission: PermissionState;
  error: string | null;
  visionReady: boolean;
  visionError: string | null;
  takes: Take[];
}

export const engineState = createStore<EngineState>({ permission: "unknown", error: null, visionReady: false, visionError: null, takes: [] });

let stream: MediaStream | null = null;
let audio: AudioEngine | null = null;
let vision: Vision | null = null;
let visionP: Promise<Vision | null> | null = null;
export const sessionId = uid();
export const getAudio = () => audio;
export const getVision = () => vision;
export const getStream = () => stream;

export async function requestMedia(booth: boolean): Promise<boolean> {
  if (stream) return true;
  if (!window.isSecureContext) { engineState.patch({ permission: "insecure" }); return false; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { engineState.patch({ permission: "unsupported" }); return false; }
  engineState.patch({ permission: "asking", error: null });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: booth ? 1920 : 1280 }, height: { ideal: booth ? 1080 : 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    engineState.patch({ permission: name === "NotFoundError" || name === "OverconstrainedError" ? "nodevice" : "denied", error: String(e) });
    return false;
  }
  audio = await createAudioEngine(stream);
  engineState.patch({ permission: "granted" });
  preloadAsr();
  stream.getVideoTracks()[0]?.addEventListener("ended", () => engineState.patch({ error: "camera" }));
  return true;
}

/** Vision needs the <video> that shows the camera; loaded lazily so the UI never waits for it. */
export function startVision(video: HTMLVideoElement): Promise<Vision | null> {
  if (visionP) return visionP;
  visionP = import("../lib/vision")
    .then((m) => m.createVision(video))
    .then((v) => { vision = v; engineState.patch({ visionReady: true }); return v; })
    .catch((e) => { console.warn("vision unavailable", e); engineState.patch({ visionError: String(e) }); return null; });
  return visionP;
}

/** Keeps the camera <video> playing: Chrome pauses muted autoplay videos it considers invisible. */
export function watchdog(video: HTMLVideoElement) {
  const id = setInterval(() => { if (video.paused && video.srcObject) video.play().catch(() => {}); }, 1000);
  return () => clearInterval(id);
}

// ── recording a take ──

export interface ActiveTake {
  settings: Settings;
  topic?: string;
  rec: Recording;
  asr: TakeAsr;
  t0: number;
  timeline: Timeline;
  stopSampler: () => void;
}

const HZ = 10;

export async function beginTake(settings: Settings, topic?: string): Promise<ActiveTake> {
  if (!stream || !audio) throw new Error("no media");
  const asr = beginTakeAsr(settings.speechLang);
  const timeline: Timeline = { hz: HZ, t: [], face: [], dH: [], dV: [], db: [], f0: [], hands: [], motion: [], smile: [], box: [] };
  // time zero = the start() call: the file starts there even when Chrome fires `start` 1.6 s later
  const rec = startRecording(stream);
  const t0 = rec.t0;
  audio.startCapture((pcm, start) => asr.push(pcm, start));
  rec.started.catch((e) => console.error("recorder", e));
  const a = audio;
  const id = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const v = vision?.sample() ?? { face: 0, dH: null, dV: null, hands: 0, motion: 0, smile: 0, box: null };
    const voice = a.voice.get();
    timeline.t.push(Math.round(t * 100) / 100);
    timeline.face.push(v.face);
    timeline.dH.push(v.dH == null ? null : Math.round(v.dH * 10) / 10);
    timeline.dV.push(v.dV == null ? null : Math.round(v.dV * 10) / 10);
    timeline.db.push(Math.round(voice.db * 10) / 10);
    timeline.f0.push(Math.round(voice.f0));
    timeline.hands.push(v.hands);
    timeline.motion.push(Math.round(v.motion * 100) / 100);
    timeline.smile.push(Math.round(v.smile * 100) / 100);
    timeline.box!.push(v.box);
  }, 1000 / HZ);
  return { settings, topic, rec, asr, t0, timeline, stopSampler: () => clearInterval(id) };
}

/** Stops recording; returns the take immediately (video playable), transcription continues in the background. */
export async function endTake(active: ActiveTake, discard = false): Promise<Take | null> {
  active.stopSampler();
  const durationSec = (performance.now() - active.t0) / 1000;
  const [raw, pcm] = await Promise.all([active.rec.stop(), audio!.stopCapture()]);
  if (discard || durationSec < 1.5) { active.asr.cancel(); return null; }
  const tr = performance.now();
  const skipRemux = /[?&]raw=1/.test(location.href);
  const video = skipRemux ? raw : await remux(raw).catch((e) => { console.warn("remux failed, using the raw recording", e); return raw; });
  console.info(`[take] ${(raw.size / 1e6).toFixed(1)} MB ${raw.type}, remux ${Math.round(performance.now() - tr)} ms`);
  const prev = engineState.get().takes;
  const take: Take = {
    id: uid(),
    n: (prev.at(-1)?.n ?? 0) + 1,
    sessionId,
    createdAt: Date.now(),
    settings: active.settings,
    topic: active.topic,
    durationSec: Math.round(durationSec * 10) / 10,
    video,
    mime: video.type,
    timeline: active.timeline,
    calib: vision?.calibration() ?? null,
    analysis: { transcript: null, fillerHits: null, status: "transcribing" },
    saved: false,
    comments: [],
  };
  engineState.patch({ takes: [...prev, take] });
  active.asr.finish(pcm).then(
    (r) => updateTake(take.id, { analysis: { transcript: r.transcript, fillerHits: r.fillerHits, status: r.transcript ? "done" : "no-asr" } }),
    (e) => updateTake(take.id, { analysis: { transcript: null, fillerHits: null, status: "error", error: String(e) } }),
  );
  return take;
}

export function updateTake(id: string, part: Partial<Take>) {
  engineState.set((s) => ({ ...s, takes: s.takes.map((t) => (t.id === id ? { ...t, ...part } : t)) }));
}

export function removeTake(id: string) {
  engineState.set((s) => ({ ...s, takes: s.takes.filter((t) => t.id !== id) }));
}

/** Booth: end of session drops every take that was not kept. */
export function resetSession() {
  engineState.patch({ takes: [] });
  vision?.resetCalibration();
}
