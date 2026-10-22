// MediaRecorder wrapper. Verified 2026-10-21 (Chrome 133 + Playwright WebKit, fake camera fed from a real clip):
// - Chrome + H.264 MP4: the camera track went silent ("muted", 0 fps) after ~11 frames, freezing the video
//   AND vision (v1 saw the same). VP8 WebM recorded every frame → Chrome records WebM; `?rec=h264` tests MP4
//   on real hardware (booth).
// - Chrome's WebM has duration = Infinity (v1's broken replay) → every take is remuxed (remux.ts) with a
//   duration and cues, so seeking is instant.
// - Chrome fires `start` up to 1.6 s late on the first recording, but the file begins at start(): take time
//   is measured from the call (Recording.t0), never from the event.
// - Safari records MP4 (Baseline; High profile wrote broken files in WebKit) and sometimes reports a bogus
//   duration for a correct blob → the player clamps with saneDuration().
const WEBM = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
const MP4 = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4"];
const MP4_HIGH = "video/mp4;codecs=avc1.640028,mp4a.40.2";
const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

export function pickMime(width = 1280): string {
  if (typeof MediaRecorder === "undefined") return "";
  const force = /[?&]rec=h264/.test(location.href) ? "h264" : /[?&]rec=webm/.test(location.href) ? "webm" : null;
  const order = force === "h264" ? [...(width > 1280 ? [MP4_HIGH] : []), ...MP4, ...WEBM]
    : force === "webm" ? WEBM
    : isSafari() ? [...MP4, ...WEBM]
    : [...WEBM, ...MP4];
  return order.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export interface Recording {
  mime: string;
  /** performance.now() of the start() call: the file's time zero. */
  t0: number;
  started: Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
}

export function startRecording(stream: MediaStream): Recording {
  const width = stream.getVideoTracks()[0]?.getSettings().width ?? 1280;
  const mimeType = pickMime(width);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: width > 1280 ? 5_000_000 : 3_000_000, audioBitsPerSecond: 128_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const started = new Promise<void>((resolve, reject) => {
    rec.onstart = () => resolve();
    rec.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error("recorder error"));
  });
  const t0 = performance.now();
  rec.start(1000);
  const type = () => (rec.mimeType || mimeType || "video/webm").split(";")[0];
  return {
    mime: mimeType,
    t0,
    started,
    stop: () =>
      new Promise((resolve) => {
        if (rec.state === "inactive") return resolve(new Blob(chunks, { type: type() }));
        rec.onstop = () => resolve(new Blob(chunks, { type: type() }));
        rec.stop();
      }),
    cancel() {
      rec.ondataavailable = null;
      if (rec.state !== "inactive") rec.stop();
    },
  };
}

/** WebM without duration (Infinity): seek far to make the browser scan it once. MP4 returns immediately.
 *  (WebKit sometimes reports a bogus finite duration for a correct blob MP4, e.g. 7158280 s; callers clamp
 *  with `saneDuration` instead of seeking.) */
export async function ensureDuration(video: HTMLVideoElement): Promise<void> {
  if (Number.isFinite(video.duration) || Number.isNaN(video.duration)) return;
  await new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener("durationchange", check); resolve(); };
    const check = () => { if (Number.isFinite(video.duration)) done(); };
    video.addEventListener("durationchange", check);
    video.currentTime = 1e101;
    setTimeout(done, 2000);
  });
  video.currentTime = 0;
}

export const extFor = (mime: string) => (mime.includes("mp4") ? "mp4" : "webm");

/** The element's duration if plausible, else the measured take length. */
export function saneDuration(video: HTMLVideoElement, measured: number): number {
  const d = video.duration;
  return Number.isFinite(d) && d > 0 && Math.abs(d - measured) <= Math.max(2, measured * 0.25) ? d : measured;
}
