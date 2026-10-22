// Playback helpers for reliable replay in Chrome and Safari.

/** A 0.1 s silent WAV, used to "bless" a <video> during a user gesture so later play() calls with sound work
 *  even when triggered by a hand gesture or a timer (Safari requires the first unmuted play in a gesture). */
function silentWav(): string {
  const sr = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
let silent: string | null = null;

export function bless(video: HTMLVideoElement) {
  if (video.dataset.blessed) return;
  silent ??= silentWav();
  video.src = silent;
  video.muted = false;
  const p = video.play();
  p?.then(() => { video.pause(); video.dataset.blessed = "1"; }).catch(() => {});
}

const urls = new Map<Blob, string>();
export function blobUrl(b: Blob): string {
  let u = urls.get(b);
  if (!u) { u = URL.createObjectURL(b); urls.set(b, u); }
  return u;
}
export function revokeBlob(b: Blob) {
  const u = urls.get(b);
  if (u) { URL.revokeObjectURL(u); urls.delete(b); }
}

export function downloadBlob(b: Blob, name: string) {
  const a = document.createElement("a");
  a.href = blobUrl(b);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Soft UI sounds (countdown ticks, start/stop), synthesised, quiet. */
let actx: AudioContext | null = null;
export function tick(freq = 880, dur = 0.08, gain = 0.06) {
  try {
    actx ??= new AudioContext();
    if (actx.state === "suspended") void actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, actx.currentTime);
    g.gain.linearRampToValueAtTime(gain, actx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur + 0.02);
  } catch { /* no audio */ }
}
