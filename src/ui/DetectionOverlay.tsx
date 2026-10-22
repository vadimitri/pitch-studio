// What the model counted, over the replay: a box around the face with the class (lens / screen / down / away) on its
// corner, from the 10 Hz take timeline, interpolated to the video frame. One absolutely positioned div, moved only when
// the video time changes. Off with the toggle; never shown to the team (measures stay with the owner).
import { useEffect, useRef } from "react";
import type { Dict } from "../i18n";
import { LOOK, type Look } from "../lib/analysis/metrics";
import { persisted, useStore } from "../lib/store";
import type { Timeline } from "../lib/types";
import { IconEye, IconEyeSlash } from "./icons";

export const overlayPref = persisted<{ on: boolean }>("ps.overlay", { on: true });
const COLOR: Record<Look, string> = { [LOOK.NONE]: "#848484", [LOOK.CAMERA]: "#2ef8e4", [LOOK.SCREEN]: "#41b0ff", [LOOK.DOWN]: "#f5ab85", [LOOK.AWAY]: "#cfa0f5" };

export const hasDetection = (tl: Timeline) => !!tl.box?.some((b) => b);
export const lookLabels = (t: Dict): Record<Look, string> =>
  ({ [LOOK.NONE]: t.replay.legend.none, [LOOK.CAMERA]: t.replay.legend.cam, [LOOK.SCREEN]: t.replay.legend.screen, [LOOK.DOWN]: t.replay.legend.down, [LOOK.AWAY]: t.replay.legend.away });

export function DetectionOverlay({ timeline, look, labels }: { timeline: Timeline; look: Look[]; labels: Record<Look, string> }) {
  const { on } = useStore(overlayPref);
  const root = useRef<HTMLDivElement>(null), boxEl = useRef<HTMLDivElement>(null), tagEl = useRef<HTMLSpanElement>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    if (!on) return;
    let raf = 0, lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = root.current, b = boxEl.current, tag = tagEl.current;
      const v = el?.parentElement?.querySelector("video");
      if (!el || !b || !tag || !v || !v.videoWidth) return;
      const bw = el.clientWidth, bh = el.clientHeight;
      const key = `${v.currentTime.toFixed(2)}|${bw}|${bh}`;
      if (key === lastKey) return; // paused and not resized: nothing to do
      lastKey = key;
      const s = Math.min(bw / v.videoWidth, bh / v.videoHeight), fw = v.videoWidth * s, fh = v.videoHeight * s;
      const ox = (bw - fw) / 2, oy = (bh - fh) / 2;
      const tl = timeline, pos = v.currentTime * tl.hz, i = Math.min(Math.floor(pos), tl.t.length - 1), f = pos - i;
      const a = tl.box?.[i], c = tl.box?.[i + 1];
      const box = a && c ? a.map((x, k) => x + (c[k] - x) * f) : a ?? c ?? null;
      const cls = box ? (look[Math.round(pos)] ?? look[i] ?? LOOK.NONE) : LOOK.NONE;
      b.style.setProperty("--det", COLOR[cls]);
      tag.textContent = labelsRef.current[cls];
      if (box) {
        b.className = "det-box";
        b.style.transform = `translate(${ox + box[0] * fw}px, ${oy + box[1] * fh}px)`;
        b.style.width = `${box[2] * fw}px`;
        b.style.height = `${box[3] * fh}px`;
      } else {
        b.className = "det-box det-none"; // no face: just the label in the frame's corner
        b.style.transform = `translate(${ox + 12}px, ${oy + 36}px)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, timeline, look]);

  return on ? <div ref={root} className="det-overlay" aria-hidden="true"><div ref={boxEl} className="det-box"><span ref={tagEl} className="det-tag" /></div></div> : null;
}

/** Small switch for the player corner. */
export function DetectionToggle({ label }: { label: string }) {
  const { on } = useStore(overlayPref);
  return (
    <button className={`det-toggle mono-xs ${on ? "on" : ""}`} aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); overlayPref.patch({ on: !on }); }}>
      {on ? <IconEye width={16} height={16} /> : <IconEyeSlash width={16} height={16} />} {label}
    </button>
  );
}
