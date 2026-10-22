// Video player with Neo controls. Takes an existing <video> element (the studio keeps one "blessed" element
// so replay can start with sound after a hand gesture) or creates its own. Time is published through a store
// so transcript and timeline can follow without re-rendering React at 60 fps.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mmss, useT } from "../i18n";
import { ensureDuration, saneDuration } from "../lib/media/recorder";
import { createStore, type Store } from "../lib/store";
import { IconPause, IconPlay } from "./icons";

export interface Marker { t: number; kind: "filler" | "best" | "comment" | "away" | "hang"; label?: string; end?: number }
export interface PlayerApi {
  seek(t: number, play?: boolean): void;
  play(): void;
  pause(): void;
  toggle(): void;
  video: HTMLVideoElement;
  time: Store<number>;
}

export function usePlayerTime() {
  return useMemo(() => createStore(0), []);
}

export function Player({
  video: external, src, duration, markers = [], startAt = 0, autoPlay = true, banner, overlay, corner, onApi, onEnded, keys = true, className = "", time: timeStore, loop = false, muted = false,
}: {
  video?: HTMLVideoElement; src: string; duration: number; markers?: Marker[]; startAt?: number; autoPlay?: boolean;
  /** banner: top left; overlay: drawn over the frame (pointer-events none); corner: top right control */
  banner?: ReactNode; overlay?: ReactNode; corner?: ReactNode; onApi?: (api: PlayerApi) => void; onEnded?: () => void; keys?: boolean; className?: string;
  time?: Store<number>; loop?: boolean; muted?: boolean;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const own = useMemo(() => {
    if (external) return external;
    const v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    v.className = "player-video";
    return v;
  }, [external]);
  const time = useMemo(() => timeStore ?? createStore(0), [timeStore]);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [rate, setRate] = useState(1);
  const [ready, setReady] = useState(false);
  const scrub = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const head = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const dur = saneDuration(own, duration);

  const api = useMemo<PlayerApi>(() => ({
    video: own,
    time,
    seek(s, play) {
      own.currentTime = Math.max(0, Math.min(s, saneDuration(own, duration) - 0.05));
      time.set(own.currentTime);
      if (play) this.play();
    },
    play() {
      own.play().then(() => setBlocked(false)).catch((e) => { if ((e as DOMException).name === "NotAllowedError") setBlocked(true); });
    },
    pause() { own.pause(); },
    toggle() { if (own.paused) this.play(); else own.pause(); },
  }), [own, time, duration]);

  // mount the element and load the source
  useEffect(() => {
    const b = box.current!;
    b.prepend(own);
    own.muted = muted;
    own.loop = loop;
    let cancelled = false;
    setReady(false);
    const load = async () => {
      if (own.src !== src) {
        own.src = src;
        await new Promise<void>((r) => {
          if (own.readyState >= 1) return r();
          own.addEventListener("loadedmetadata", () => r(), { once: true });
          own.addEventListener("error", () => r(), { once: true });
        });
        await ensureDuration(own);
      }
      if (cancelled) return;
      own.currentTime = startAt;
      time.set(startAt);
      setReady(true);
      onApi?.(api);
      if (autoPlay) api.play();
    };
    void load();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); onEnded?.(); };
    own.addEventListener("play", onPlay);
    own.addEventListener("pause", onPause);
    own.addEventListener("ended", onEnd);
    return () => {
      cancelled = true;
      own.pause();
      own.removeEventListener("play", onPlay);
      own.removeEventListener("pause", onPause);
      own.removeEventListener("ended", onEnd);
      if (own.parentElement === b) b.removeChild(own);
    };
  }, [own, src]); // eslint-disable-line react-hooks/exhaustive-deps

  // time loop → store + playhead (imperative)
  useEffect(() => {
    let raf = 0;
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn);
      const ct = own.currentTime || 0;
      if (Math.abs(ct - time.get()) > 0.02) time.set(ct);
      const d = saneDuration(own, duration);
      if (!own.paused && ct >= d - 0.03 && !own.ended) { own.pause(); onEndedRef.current?.(); } // WebKit with a bogus duration
      if (head.current) head.current.style.transform = `scaleX(${d ? Math.min(1, ct / d) : 0})`;
      if (clock.current) clock.current.textContent = `${mmss(ct)} / ${mmss(d)}`;
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [own, time, duration]);

  // Space = play/pause, ←/→ = 5 s
  useEffect(() => {
    if (!keys) return;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === " ") { e.preventDefault(); api.toggle(); }
      else if (e.key === "ArrowLeft") api.seek(own.currentTime - 5);
      else if (e.key === "ArrowRight") api.seek(own.currentTime + 5);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [api, keys, own]);

  useEffect(() => { own.playbackRate = rate; }, [own, rate]);

  const seekFromPointer = (e: React.PointerEvent) => {
    const r = scrub.current!.getBoundingClientRect();
    api.seek(((e.clientX - r.left) / r.width) * dur);
  };

  return (
    <div className={`player ${className}`}>
      <div className="player-box" ref={box} onClick={() => api.toggle()}>
        {overlay}
        {banner && <div className="player-banner">{banner}</div>}
        {corner && <div className="player-corner">{corner}</div>}
        {(blocked || (ready && !playing)) && (
          <button className="player-big-play" onClick={(e) => { e.stopPropagation(); api.play(); }} aria-label={t.replay.play}>
            <IconPlay width={30} height={30} />
          </button>
        )}
      </div>
      <div className="player-controls">
        <button className="player-btn" onClick={() => api.toggle()} aria-label={playing ? t.replay.pause : t.replay.play}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <div
          className="player-scrub" ref={scrub}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); seekFromPointer(e); }}
          onPointerMove={(e) => { if (e.buttons) seekFromPointer(e); }}
          role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} tabIndex={0}
        >
          <div className="player-track" />
          <div className="player-head" ref={head} />
          {markers.map((m, i) => (
            <span key={i} className={`player-mark mark-${m.kind}`} title={m.label}
              style={{ left: `${(m.t / dur) * 100}%`, width: m.end ? `${((m.end - m.t) / dur) * 100}%` : undefined }} />
          ))}
        </div>
        <span ref={clock} className="mono-xs player-time tnum">0:00 / {mmss(dur)}</span>
        <button className="player-btn player-rate mono-xs" onClick={() => setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1))} aria-label={t.replay.speed}>
          {rate}×
        </button>
      </div>
    </div>
  );
}
