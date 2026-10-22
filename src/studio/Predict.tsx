// Predict first, then watch "like a stranger" (Harvey et al. 2000; Warnock-Parkes et al. 2017).
import { useT } from "../i18n";
import type { Prediction } from "../lib/types";
import { DemoNote } from "../ui/DemoNote";
import { Kbd } from "../ui/primitives";
import { GestureRing, HAND_ICON, type HandGesture } from "./GestureRing";

const OPTS: { p: Prediction; key: string; arrow: string; g: HandGesture }[] = [
  { p: "good", key: "1", arrow: "↑", g: "Thumb_Up" },
  { p: "ok", key: "2", arrow: "→", g: "Open_Palm" },
  { p: "bad", key: "3", arrow: "↓", g: "Thumb_Down" },
];

export function Predict({ onPick, gestures }: { onPick: (p: Prediction | null) => void; gestures: boolean }) {
  const t = useT();
  return (
    <main className="screen predict">
      <h1 className="display-m">{t.studio.predictTitle}</h1>
      <p className="paragraph-l fg-2">{t.studio.predictHint}</p>
      <div className="predict-opts">
        {OPTS.map((o) => {
          const Icon = HAND_ICON[o.g];
          return (
            <button key={o.p} className={`predict-opt predict-${o.p}`} onClick={() => onPick(o.p)}>
              <Icon className="predict-icon" size={44} />
              <span className="heading-m">{t.studio.predict[o.p]}</span>
              <span className="row gap-2"><Kbd>{o.arrow}</Kbd><Kbd>{o.key}</Kbd></span>
              {gestures && <GestureRing name={o.g} />}
            </button>
          );
        })}
      </div>
      <button className="btn btn-ghost btn-s" onClick={() => onPick(null)}>{t.studio.predictSkip}</button>
      <DemoNote k="predict" className="note-center" />
    </main>
  );
}
