// Timeline lanes under the video: eye contact (class per sample) and speech (words, fillers, long pauses).
// Click or drag to seek. Canvas for the data, a div for the playhead.
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { LOOK, type Metrics } from "../lib/analysis/metrics";
import type { Store } from "../lib/store";
import type { Timeline, Word } from "../lib/types";

const C = {
  cam: "#2ef8e4", screen: "#41b0ff", down: "#f5ab85", away: "#cfa0f5", // Neo green, blue, peach, lilac
  word: "#b5b5b5", filler: "#fd5f31", hang: "#c7e750", comment: "#ffffff", grid: "#212121",
};
const LANE_Y = (i: number) => 4 + i * 26, LANE_H = 18;

export function Lanes({ timeline, metrics, words, duration, time, onSeek, comments = [] }: {
  timeline: Timeline; metrics: Metrics; words: Word[] | null; duration: number; time: Store<number>;
  onSeek: (t: number) => void; comments?: { t: number }[];
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvas.current!, w = wrap.current!;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = w.clientWidth, H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const x = cv.getContext("2d")!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      const X = (s: number) => (s / duration) * W;
      for (let i = 0; i < 2; i++) { x.fillStyle = C.grid; x.fillRect(0, LANE_Y(i), W, LANE_H); }
      // eye contact
      const n = timeline.t.length, hz = timeline.hz, gy = LANE_Y(0);
      for (let i = 0; i < n; i++) {
        const l = metrics.look[i];
        if (l === LOOK.NONE) continue;
        x.fillStyle = l === LOOK.CAMERA ? C.cam : l === LOOK.SCREEN ? C.screen : l === LOOK.DOWN ? C.down : C.away;
        x.fillRect(X(i / hz), gy, Math.max(1, X(1 / hz)) + 0.5, LANE_H);
      }
      // speech: words, long pauses (≥ 3 s), fillers
      const sy = LANE_Y(1);
      if (words) for (const wd of words) { x.fillStyle = C.word; x.fillRect(X(wd.s), sy + 6, Math.max(1, X(wd.e) - X(wd.s) - 1), LANE_H - 12); }
      if (metrics.speech) {
        for (const p of metrics.speech.pauses) if (p.kind === "hang") { x.fillStyle = C.hang; x.fillRect(X(p.s), sy + 3, X(p.e) - X(p.s), LANE_H - 6); }
        for (const f of metrics.speech.fillers.items) { x.fillStyle = C.filler; x.fillRect(X(f.t) - 1.5, sy, 3, LANE_H); }
      }
      for (const c of comments) { x.fillStyle = C.comment; x.beginPath(); x.arc(X(c.t), H - 3, 2.5, 0, Math.PI * 2); x.fill(); }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [timeline, metrics, words, duration, comments]);

  useEffect(() => time.subscribe(() => {
    if (head.current) head.current.style.left = `${Math.min(100, (time.get() / duration) * 100)}%`;
  }), [time, duration]);

  const seek = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };

  const L = t.replay.legend;
  return (
    <div className="lanes">
      <div className="lane-labels mono-xs fg-3">
        <span>{t.replay.lanes.gaze}</span><span>{t.replay.lanes.speech}</span>
      </div>
      <div className="lane-canvas" ref={wrap}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); seek(e); }}
        onPointerMove={(e) => { if (e.buttons) seek(e); }}>
        <canvas ref={canvas} />
        <div className="lane-head" ref={head} />
      </div>
      <div className="lane-legend mono-xs fg-2">
        <span><i style={{ background: C.cam }} />{L.cam}</span>
        <span><i style={{ background: C.screen }} />{L.screen}</span>
        <span><i style={{ background: C.down }} />{L.down}</span>
        <span><i style={{ background: C.away }} />{L.away}</span>
        <span className="legend-gap"><i style={{ background: C.word }} />{L.word}</span>
        <span><i style={{ background: C.filler }} />{L.filler}</span>
        <span><i style={{ background: C.hang }} />{L.pause}</span>
      </div>
    </div>
  );
}
