// Fills while the matching hand gesture is held (vision fires after 0.6 s).
import type { IconProps } from "@phosphor-icons/react";
import { useEffect, useRef, type ComponentType } from "react";
import { useT } from "../i18n";
import type { GestureName } from "../lib/vision";
import { IconPalm, IconThumbDown, IconThumbUp, IconVictory } from "../ui/icons";
import { getVision } from "./engine";

export type HandGesture = "Open_Palm" | "Thumb_Up" | "Thumb_Down" | "Victory";
export const HAND_ICON: Record<HandGesture, ComponentType<IconProps>> = {
  Open_Palm: IconPalm, Thumb_Up: IconThumbUp, Thumb_Down: IconThumbDown, Victory: IconVictory,
};

export function GestureRing({ name, size = 28 }: { name: HandGesture; size?: number }) {
  const t = useT();
  const ref = useRef<SVGCircleElement>(null);
  const r = (size - 3) / 2, c = 2 * Math.PI * r;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const g = getVision()?.state.get().gesture;
      const p = g && (g.name as GestureName) === name ? g.progress : 0;
      if (ref.current) ref.current.style.strokeDashoffset = String(c * (1 - p));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [name, c]);
  const Icon = HAND_ICON[name];
  return (
    <span className="gesture-ring" style={{ width: size, height: size }} title={`${t.gestures[name]} · ${t.gestures.hold}`}>
      <svg className="gesture-track" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-20)" strokeWidth={2} />
        <circle ref={ref} cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--green)" strokeWidth={2.5}
          strokeDasharray={c} strokeDashoffset={c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <Icon className="gesture-icon" size={Math.round(size * 0.58)} />
    </span>
  );
}
