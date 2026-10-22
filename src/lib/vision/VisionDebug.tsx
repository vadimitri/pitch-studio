// Debug overlay for the vision pipeline (mounted with ?debug=1): face box, gaze arrow, rel angles, look class,
// fps/backend and a small polar plot of rel gaze with the calibration radius and screen point.
import { useEffect, useRef, useState } from "react";
import { createStore, useStore, type Store } from "../store";
import type { Vision, VisionState } from "./index";
import { activeVision } from "./registry";

const LOOK_COLOR: Record<string, string> = { camera: "#3ddc84", screen: "#4aa3ff", down: "#ffb020", away: "#ff4d4d", none: "#888" };

interface Rect { left: number; top: number; width: number; height: number }

/** Where the video's pixels land on screen (object-fit contain/cover/fill) and whether it is shown mirrored. */
function videoRect(v: HTMLVideoElement): { r: Rect; mirrored: boolean } | null {
  const b = v.getBoundingClientRect();
  if (!b.width || !v.videoWidth) return null;
  const cs = getComputedStyle(v), fit = cs.objectFit;
  const va = v.videoWidth / v.videoHeight, ba = b.width / b.height;
  let w = b.width, h = b.height;
  if (fit === "contain" || fit === "" || fit === "scale-down") { if (va > ba) h = w / va; else w = h * va; }
  else if (fit === "cover") { if (va > ba) w = h * va; else h = w / va; }
  const mirrored = /^matrix\(\s*-1/.test(cs.transform) || cs.scale.startsWith("-1");
  return { r: { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h }, mirrored };
}

const idle = createStore<VisionState | null>(null);

/** `vision` defaults to the most recently created instance (createVision registers itself). */
export function VisionDebug({ vision: given, video }: { vision?: Vision | null; video: HTMLVideoElement | null }) {
  const latest = useStore(activeVision);
  const vision = given ?? latest;
  const st = useStore((vision?.state ?? idle) as Store<VisionState | null>);
  const [geo, setGeo] = useState<{ r: Rect; mirrored: boolean } | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => { if (video) setGeo((g) => { const n = videoRect(video); return JSON.stringify(n) === JSON.stringify(g) ? g : n; }); raf.current = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf.current);
  }, [video]);
  if (!vision || !st) return <div style={{ font: "11px ui-monospace, monospace", color: "#aaa", background: "rgba(0,0,0,.7)", padding: 6 }}>vision loading…</div>;
  const s = st;
  const calib = vision.calibration();
  const radius = calib?.radius ?? 9;

  let box = null;
  if (geo && s.box) {
    const { r, mirrored } = geo;
    const bx = mirrored ? 1 - s.box.x - s.box.w : s.box.x;
    const x = r.left + bx * r.width, y = r.top + s.box.y * r.height, w = s.box.w * r.width, h = s.box.h * r.height;
    const cx = x + w / 2, cy = y + h * 0.42;
    const g = s.rel ?? (s.gaze ? { dH: s.gaze.h, dV: s.gaze.v } : null);
    const len = w * 1.2;
    const ax = g ? cx + Math.sin((g.dH * Math.PI) / 180) * len * (mirrored ? -1 : 1) : cx;
    const ay = g ? cy + Math.sin((g.dV * Math.PI) / 180) * len : cy;
    box = (
      <svg style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 9998 }}>
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={LOOK_COLOR[s.look]} strokeWidth={2} />
        {g && <line x1={cx} y1={cy} x2={ax} y2={ay} stroke="#ff3bd4" strokeWidth={3} />}
        {g && <circle cx={ax} cy={ay} r={4} fill="#ff3bd4" />}
      </svg>
    );
  }

  // polar plot: ±30° square, rel gaze in plot coordinates (as seen from the camera, unmirrored)
  const P = 140, span = 30, k = P / 2 / span;
  const pt = (h: number, v: number) => ({ x: P / 2 + h * k, y: P / 2 + v * k });
  const cur = s.rel ? pt(s.rel.dH, s.rel.dV) : null;
  const scr = calib?.screen ? pt(calib.screen.h, calib.screen.v) : null;
  const n = (x: number | undefined | null, d = 1) => (x == null ? "–" : x.toFixed(d));

  return (
    <>
      {box}
      <div style={{ position: "fixed", right: 8, bottom: 8, zIndex: 9999, background: "rgba(0,0,0,.78)", color: "#eee", font: "11px/1.35 ui-monospace, monospace", padding: 8, borderRadius: 6, width: 300, pointerEvents: "none" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <svg width={P} height={P} style={{ background: "#111", flex: "none" }}>
            <line x1={0} y1={P / 2} x2={P} y2={P / 2} stroke="#333" />
            <line x1={P / 2} y1={0} x2={P / 2} y2={P} stroke="#333" />
            <circle cx={P / 2} cy={P / 2} r={radius * k} fill="none" stroke="#3ddc84" strokeDasharray="3 2" />
            {scr && <circle cx={scr.x} cy={scr.y} r={4} fill="#4aa3ff" />}
            {cur && <circle cx={cur.x} cy={cur.y} r={4} fill={LOOK_COLOR[s.look]} />}
            <text x={3} y={11} fill="#666" fontSize={9}>±{span}°</text>
          </svg>
          <div>
            <div style={{ color: LOOK_COLOR[s.look], fontWeight: 700, fontSize: 14 }}>{s.look}</div>
            <div>dH {n(s.rel?.dH)} dV {n(s.rel?.dV)}</div>
            <div>raw {n(s.gaze?.h)} / {n(s.gaze?.v)}</div>
            <div>head yaw {n(s.yaw)} pitch {n(s.pitch)}</div>
            <div>face {s.face ? `${s.facePx}px` : "–"}{s.blink ? " blink" : ""}</div>
            <div>hands {s.hands} motion {n(s.motion)}</div>
            <div>smile {n(s.smile, 2)}</div>
            <div>{s.gesture ? `${s.gesture.name} ${Math.round(s.gesture.progress * 100)}%` : "no gesture"}</div>
          </div>
        </div>
        <div style={{ marginTop: 4, color: "#aaa" }}>
          face {s.perf.faceFps} fps · gaze {s.perf.gazeHz} Hz {s.perf.gazeMs} ms<br />
          {s.perf.backend}<br />
          calib {calib ? `r ${n(calib.radius)}° sd ${n(calib.spread)}° d′ ${n(calib.separation)}` : "none"}
          {s.error && <div style={{ color: "#ff6b6b" }}>{s.error}</div>}
        </div>
      </div>
    </>
  );
}
