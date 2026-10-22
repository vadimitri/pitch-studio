// Calibration, once per session (~9 s): look into the lens, then follow a dot to five places on the screen. The dots
// give a per-person map from gaze angles to screen pixels (fitGazeMap), so gain and offset are the person's own and the
// lens zone, the screen, below it and "elsewhere" (a monitor above, the room) are real places instead of a fixed circle.
// If the dots don't fit, the lens + centre samples still give the simple degree rule.
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { buildCalibration, CALIB, fitGazeMap, gazeStats, type GazeStats } from "../lib/vision/filters";
import { DemoNote } from "../ui/DemoNote";
import { IconArrowUp } from "../ui/icons";
import { Ring } from "../ui/primitives";
import { getVision } from "./engine";
import { tick } from "./media-helpers";
import type { CamPos } from "./Studio";

const LENS_SETTLE = 700, LENS_MS = 1800, DOT_SETTLE = 450, DOT_MS = 900;
/** Dot positions as fractions of the viewport: centre first (the fallback rule needs it), then around the edges. */
export const DOTS: [number, number][] = [[0.5, 0.5], [0.5, 0.1], [0.92, 0.45], [0.5, 0.9], [0.08, 0.45]];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ui = { step: "wait" | "lens" | "dot"; i: number; t0: number; dur: number };

export function Calibrate({ camPos, onDone, skippable = true }: { camPos: CamPos; onDone: (ok: boolean) => void; skippable?: boolean }) {
  const t = useT();
  const [ui, setUi] = useState<Ui>({ step: "wait", i: 0, t0: 0, dur: 1 });
  const [p, setP] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setP(ui.step === "wait" ? 0 : Math.min(1, (performance.now() - ui.t0) / ui.dur)), 40);
    return () => clearInterval(id);
  }, [ui]);

  useEffect(() => {
    const v = getVision();
    if (!v) { onDone(false); return; }
    let cancelled = false;
    (async () => {
      // first visit: the gaze model may still be loading; wait for real gaze values (max 6 s)
      const until = performance.now() + 6000;
      while (!cancelled && !v.state.get().gaze && performance.now() < until) await sleep(150);
      if (cancelled) return;
      if (!v.state.get().gaze) { onDone(false); return; } // retried automatically on the next take

      setUi({ step: "lens", i: 0, t0: performance.now(), dur: LENS_SETTLE + LENS_MS });
      await sleep(LENS_SETTLE); // eyes travel from the text to the lens
      const lensSamples = await v.collect(LENS_MS);
      if (cancelled) return;
      const lens = gazeStats(lensSamples);
      if (!lens || lensSamples.length < 5 || lens.sd > CALIB.maxSpreadDeg) { onDone(false); return; }
      tick(880, 0.08);

      const dots: { h: number; v: number; x: number; y: number }[] = [];
      let centre: GazeStats | null = null;
      for (let i = 0; i < DOTS.length; i++) {
        setUi({ step: "dot", i, t0: performance.now(), dur: DOT_SETTLE + DOT_MS });
        await sleep(DOT_SETTLE);
        const s = await v.collect(DOT_MS);
        if (cancelled) return;
        const st = gazeStats(s);
        if (!st || s.length < 4) continue;
        if (i === 0) centre = st;
        dots.push({ h: st.h, v: st.v, x: DOTS[i][0] * innerWidth, y: DOTS[i][1] * innerHeight });
      }
      tick(1320, 0.08);
      const map = fitGazeMap(dots, lens, innerWidth, innerHeight);
      v.setCalibration({ ...buildCalibration(lens, centre), map });
      onDone(true);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dot = ui.step === "dot" ? DOTS[ui.i] : null;
  return (
    <main className={`screen calibrate cam-${camPos}`}>
      {ui.step !== "dot" ? (
        <div className="lens-target">
          <span className="lens-hint"><IconArrowUp width={22} height={22} /></span>
          <Ring value={p} size={56} stroke={3} color="var(--green)" track="var(--gray-20)">
            <span className="lens-dot" />
          </Ring>
          <h1 className="heading-xl">{t.studio.calibTitle}</h1>
          <p className="paragraph-l fg-2">{t.studio.calibText}</p>
        </div>
      ) : (
        <>
          <span className="calib-dot" style={{ left: `${dot![0] * 100}%`, top: `${dot![1] * 100}%` }}>
            <Ring value={1 - p} size={44} stroke={3} color="var(--blue)" track="transparent"><span className="screen-dot" /></Ring>
          </span>
          <p className="calib-follow heading-s">{t.studio.calibScreen}</p>
        </>
      )}
      {skippable && <p className="calib-skip paragraph-s fg-3">{t.studio.calibSkip} · Space</p>}
      <DemoNote k="calibrate" className="note-corner" />
    </main>
  );
}
