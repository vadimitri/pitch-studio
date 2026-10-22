// Live gesture feedback near the lens, so you see the camera understood your hand before anything happens:
// hand seen → gesture recognised (ring fills while you hold, with the action it will trigger) → done.
// Keep the labels in sync with the gesture handler in Studio.tsx.
import { useEffect, useRef, useState } from "react";
import { useT, type Dict } from "../i18n";
import { createStore, useStore, type Store } from "../lib/store";
import type { GestureName, VisionState } from "../lib/vision";
import { IconCheck, IconPalm } from "../ui/icons";
import { getVision } from "./engine";
import { GestureRing, HAND_ICON, type HandGesture } from "./GestureRing";
import type { Phase } from "./Studio";

export function gestureLabels(phase: Phase, t: Dict): Partial<Record<HandGesture, string>> {
  switch (phase) {
    case "setup": return { Open_Palm: t.studio.start };
    case "predict": return { Thumb_Up: t.studio.predict.good, Open_Palm: t.studio.predict.ok, Thumb_Down: t.studio.predict.bad };
    case "replay": return { Open_Palm: t.replay.again, Thumb_Up: t.replay.share, Victory: t.replay.compare, Thumb_Down: t.replay.delete };
    case "compare": return { Victory: t.common.back, Open_Palm: t.common.back };
    default: return {};
  }
}

const idle = createStore<VisionState | null>(null);
const isHand = (n: GestureName): n is HandGesture => n in HAND_ICON;

export function GestureHud({ phase }: { phase: Phase }) {
  const t = useT();
  const v = getVision();
  const st = useStore((v?.state ?? idle) as Store<VisionState | null>);
  const labels = gestureLabels(phase, t);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [fired, setFired] = useState<{ name: HandGesture; label: string } | null>(null);

  useEffect(() => {
    if (!v) return;
    let timer = 0;
    const off = v.onGesture((n) => {
      const label = isHand(n) ? labelsRef.current[n] : undefined;
      if (!label || !isHand(n)) return;
      setFired({ name: n, label });
      clearTimeout(timer);
      timer = window.setTimeout(() => setFired(null), 1100);
    });
    return () => { off(); clearTimeout(timer); };
  }, [v]);

  if (!st) return null;
  const g = st.gesture && isHand(st.gesture.name) ? st.gesture : null;
  let body: React.ReactNode = null, cls = "";
  if (fired) {
    const Icon = HAND_ICON[fired.name];
    cls = "done";
    body = <><span className="hud-icon"><Icon size={26} /></span><IconCheck width={18} height={18} /><span className="label-m">{fired.label}</span></>;
  } else if (g && labels[g.name as HandGesture]) {
    cls = "active";
    body = <><GestureRing name={g.name as HandGesture} size={46} /><span className="stack"><span className="label-m">{labels[g.name as HandGesture]}</span><span className="mono-xs hud-sub">{t.gestures[g.name]} · {t.gestures.hold}</span></span></>;
  } else if (g) {
    const Icon = HAND_ICON[g.name as HandGesture];
    cls = "idle";
    body = <><span className="hud-icon"><Icon size={22} /></span><span className="mono-xs">{t.gestures[g.name]} · {t.gestures.unused}</span></>;
  } else if (st.hands > 0) {
    cls = "idle";
    body = <><span className="hud-icon"><IconPalm width={22} height={22} /></span><span className="mono-xs">{t.gestures.seen}</span></>;
  }
  return <div className={`gesture-hud ${cls}`} role="status" aria-live="polite">{body}</div>;
}
