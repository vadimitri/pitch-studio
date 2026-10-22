import { useEffect, useState } from "react";
import { useT } from "../i18n";
import type { AudienceMode } from "../lib/types";
import { Audience } from "../ui/Audience";
import { IconArrowUp } from "../ui/icons";
import { KeyVisual } from "../ui/KeyVisual";
import { tick } from "./media-helpers";
import type { CamPos } from "./Studio";

/** Small arrow to the camera: where to look while talking. */
export function LensArrow({ camPos }: { camPos: CamPos }) {
  const t = useT();
  return (
    <span className={`lens-hint lens-hint-${camPos}`} aria-hidden="true">
      <IconArrowUp width={18} height={18} /><span className="mono-xs">{t.studio.lens}</span>
    </span>
  );
}

export function Countdown({ camPos, audience, topic, isQuestion, onDone }: { camPos: CamPos; audience: AudienceMode; topic?: string; isQuestion?: boolean; onDone: () => void }) {
  const t = useT();
  const [n, setN] = useState(3);
  const [p, setP] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    tick(880);
    let last = 3;
    const id = setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      setP(Math.min(1, el / 3));
      const left = 3 - Math.floor(el);
      if (left !== last && left > 0) { tick(880); last = left; setN(left); }
      if (el >= 3) { clearInterval(id); onDone(); }
    }, 40);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className={`screen countdown cam-${camPos}`}>
      <div className="near-lens">
        <LensArrow camPos={camPos} />
        <span className="mono-xs fg-3">{t.studio.countdownGetReady}</span>
        <span key={n} className="count-n">{n}</span>
        {audience !== "off" && <Audience className="rec-audience aud-enter" mode={audience} count={6} rows={1} seed={9} />}
        {topic && (
          <div className="rec-topic">
            <span className="mono-xs fg-3">{isQuestion ? t.studio.question : t.studio.topic}</span>
            <p className="heading-s">{topic}</p>
          </div>
        )}
      </div>
      <KeyVisual preset="tall" unit="1.1vw" progress={p} animate={false} className="countdown-kv" />
    </main>
  );
}
