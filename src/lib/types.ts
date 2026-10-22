// Shared data model. Times are seconds from the start of the take unless noted.

export type UiLang = "en" | "de";
export type SpeechLang = "en" | "de";
export type BriefId = "free" | "elevator" | "startup" | "explain" | "random" | "hotseat";
export type FocusId = "auto" | "fillers" | "pace" | "gaze" | "time";
export type AudienceMode = "friendly" | "tough" | "off";
export type Prediction = "good" | "ok" | "bad";

export interface Settings {
  brief: BriefId;
  targetSec: number;
  focus: FocusId;
  audience: AudienceMode;
  speechLang: SpeechLang;
  cue: boolean; // one-word live cue for the chosen focus, max every 25 s
  gestures: boolean;
}

/** Columnar samples at `hz`. Gaze angles in degrees relative to the calibrated lens direction:
 *  dH > 0 = speaker looks to image right, dV > 0 = looks down. null = no face / blink. */
export interface Timeline {
  hz: number;
  t: number[];
  face: number[]; // 0 | 1
  dH: (number | null)[];
  dV: (number | null)[];
  db: number[]; // level dBFS
  f0: number[]; // pitch Hz, 0 = unvoiced
  hands: number[]; // hands visible (0..2)
  motion: number[]; // hand motion, face widths / s
  smile: number[]; // 0..1
  /** Face box [x, y, w, h], normalised to the frame; for the replay overlay. */
  box?: (number[] | null)[];
}

export interface Calibration {
  /** Raw gaze (deg) while looking into the lens. */
  cam: { h: number; v: number };
  /** Screen centre relative to the lens (deg), null if not sampled or too close to tell apart. */
  screen: { h: number; v: number } | null;
  spread: number; // deg, SD of the lens sample
  /** "At camera" radius in deg for this person/setup: min(8, half the lens–screen distance). */
  radius?: number;
  /** d′ between lens and screen samples; < 2 = setup cannot tell lens from screen. */
  separation?: number | null;
  /** Per-person map from raw gaze to the viewport, fitted on the dot calibration (null: dots failed, legacy rule). */
  map?: GazeMap | null;
  at: number;
}

/** Affine map raw gaze (deg) → viewport CSS px: x = a0 + a1·h + a2·v, y = a3 + a4·h + a5·v. */
export interface GazeMap {
  a: [number, number, number, number, number, number];
  lens: { x: number; y: number }; // where the lens sample lands (above the viewport when the camera sits on top)
  r: number; // lens zone radius, px
  vw: number; vh: number; // viewport the dots were shown in
  rms: number; // fit residual of the dots, px
}

export interface Word {
  w: string;
  s: number;
  e: number;
}

export interface Transcript {
  words: Word[];
  text: string;
  engine: string; // human readable, e.g. "Whisper base · WebGPU · local"
  ms: number; // time spent after stop
  lang: SpeechLang;
}

/** Filler candidates from an audio model or heuristic (seconds). */
export interface FillerHit {
  s: number;
  e: number;
  label: string; // "uh" | "um" | "hmm"
  conf: number;
}

export type CommentKind = "lands" | "lost" | "drags" | "keep" | "change" | "try";
export interface Comment {
  id: string;
  t: number;
  kind: CommentKind;
  text?: string;
  author?: string;
  at: number; // epoch ms
  example?: boolean; // demo note from "Add example notes"
}

export interface TakeAnalysis {
  transcript: Transcript | null;
  fillerHits: FillerHit[] | null;
  status: "pending" | "transcribing" | "done" | "no-asr" | "error";
  error?: string;
}

export interface Take {
  id: string;
  n: number; // take number in the session
  sessionId: string;
  createdAt: number;
  settings: Settings;
  topic?: string; // random topic / hot-seat question shown before the take
  durationSec: number;
  video: Blob;
  mime: string;
  timeline: Timeline;
  calib: Calibration | null;
  prediction?: Prediction;
  analysis: TakeAnalysis;
  saved: boolean;
  title?: string;
  poster?: string; // small JPEG data URL for lists
  comments: Comment[];
}
