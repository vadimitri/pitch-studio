// Eye-contact check (~40 s): calibrate, then look at seven known places. Shows how often the studio got each one
// right, with the gaze map and with the old fixed circle, and lets you download the raw samples. This is the
// validation tool (10 people × 2 min) in small, and the evidence for changing any threshold.
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { LOOK, lookOf, type Look } from "../lib/analysis/metrics";
import type { GazeSample } from "../lib/vision";
import { IconArrowUp, IconDownload } from "../ui/icons";
import { Button, Kbd, Ring } from "../ui/primitives";
import { Calibrate } from "./Calibrate";
import { getVision } from "./engine";
import { downloadBlob, tick } from "./media-helpers";
import type { CamPos } from "./Studio";

type TargetKey = "lens" | "dotTopLeft" | "dotCentre" | "below" | "above" | "side" | "lensAgain";
const TARGETS: { k: TargetKey; expect: Look; at?: [number, number] }[] = [
  { k: "lens", expect: LOOK.CAMERA },
  { k: "dotTopLeft", expect: LOOK.SCREEN, at: [0.15, 0.22] },
  { k: "dotCentre", expect: LOOK.SCREEN, at: [0.55, 0.55] },
  { k: "below", expect: LOOK.DOWN },
  { k: "above", expect: LOOK.AWAY },
  { k: "side", expect: LOOK.AWAY },
  { k: "lensAgain", expect: LOOK.CAMERA },
];
const SETTLE_MS = 1300, COLLECT_MS = 1600;
const NAME: Record<Look, "none" | "camera" | "screen" | "down" | "away"> = { [LOOK.NONE]: "none", [LOOK.CAMERA]: "camera", [LOOK.SCREEN]: "screen", [LOOK.DOWN]: "down", [LOOK.AWAY]: "away" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Result { k: TargetKey; expect: Look; samples: (GazeSample & { now: Look; old: Look })[] }
const share = (r: Result, key: "now" | "old") => (r.samples.length ? r.samples.filter((s) => s[key] === r.expect).length / r.samples.length : null);
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)} %`);

export function GazeCheck({ camPos, onDone }: { camPos: CamPos; onDone: () => void }) {
  const t = useT();
  const C = t.check;
  const [stage, setStage] = useState<"intro" | "calibrate" | "test" | "result">("intro");
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " && (stage === "intro" || stage === "result")) { e.preventDefault(); setStage("calibrate"); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stage]);

  useEffect(() => {
    if (stage !== "test") return;
    const v = getVision();
    const calib = v?.calibration() ?? null;
    if (!v || !calib) { setResults([]); setStage("result"); return; }
    let cancelled = false;
    (async () => {
      const out: Result[] = [];
      for (let n = 0; n < TARGETS.length; n++) {
        setI(n);
        await sleep(SETTLE_MS);
        const raw = await v.collect(COLLECT_MS);
        if (cancelled) return;
        tick(990, 0.05, 0.04);
        const T = TARGETS[n];
        out.push({
          k: T.k, expect: T.expect,
          samples: raw.map((s) => {
            const dH = s.h - calib.cam.h, dV = s.v - calib.cam.v;
            return { ...s, now: lookOf(dH, dV, calib), old: lookOf(dH, dV, { ...calib, map: null }) };
          }),
        });
      }
      setResults(out);
      setStage("result");
    })();
    return () => { cancelled = true; };
  }, [stage]);

  const download = () => {
    const calib = getVision()?.calibration() ?? null;
    const data = { at: new Date().toISOString(), ua: navigator.userAgent, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, camPos, calib, results };
    downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), `pitch-studio-gaze-check-${Date.now()}.json`);
  };

  if (stage === "calibrate") return <Calibrate camPos={camPos} skippable={false} onDone={() => setStage("test")} />;

  if (stage === "test") {
    const T = TARGETS[i];
    return (
      <main className={`screen check cam-${camPos}`}>
        {T.at ? (
          <span className="calib-dot" style={{ left: `${T.at[0] * 100}%`, top: `${T.at[1] * 100}%` }}>
            <Ring value={1} size={44} stroke={3} color="var(--blue)" track="transparent"><span className="screen-dot" /></Ring>
          </span>
        ) : (
          <div className="check-say">
            {(T.k === "lens" || T.k === "lensAgain") && <span className="lens-hint"><IconArrowUp width={28} height={28} /></span>}
            <h1 className="display-m">{C.targets[T.k]}</h1>
          </div>
        )}
        <p className="calib-follow mono-xs fg-3">{C.step(i + 1, TARGETS.length)}</p>
      </main>
    );
  }

  if (stage === "result") {
    const calib = getVision()?.calibration() ?? null;
    const cam = results.filter((r) => r.expect === LOOK.CAMERA), other = results.filter((r) => r.expect !== LOOK.CAMERA);
    const rate = (rs: Result[], key: "now" | "old", hit: boolean) => {
      const all = rs.flatMap((r) => r.samples);
      return all.length ? all.filter((s) => (s[key] === LOOK.CAMERA) === hit).length / all.length : null;
    };
    return (
      <main className="screen check check-result">
        <div className="check-card">
          <h1 className="heading-xl">{C.resultTitle}</h1>
          {!results.length ? <p className="paragraph-m fg-2">{C.noData}</p> : (
            <>
              <div className="check-summary">
                <div><span className="mono-xs fg-2">{C.lensHit}</span><span className="heading-l tnum">{pct(rate(cam, "now", true))}</span><span className="mono-xs fg-3">{C.before} {pct(rate(cam, "old", true))}</span></div>
                <div><span className="mono-xs fg-2">{C.falseLens}</span><span className="heading-l tnum">{pct(rate(other, "now", true))}</span><span className="mono-xs fg-3">{C.before} {pct(rate(other, "old", true))}</span></div>
              </div>
              <table className="compare-table check-table">
                <thead><tr><th className="mono-xs fg-2">{C.colTarget}</th><th className="mono-xs fg-2">{C.colExpect}</th><th className="mono-xs fg-2">{C.colNow}</th><th className="mono-xs fg-2">{C.colOld}</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.k}><td>{C.rows[r.k]}</td><td className="mono-xs">{C.expect[NAME[r.expect] as keyof typeof C.expect]}</td><td className="tnum label-m">{pct(share(r, "now"))}</td><td className="tnum fg-2">{pct(share(r, "old"))}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="paragraph-xs fg-3">{calib?.map ? C.mapOk(Math.round(calib.map.rms)) : C.mapFail}</p>
            </>
          )}
          <div className="row gap-3">
            <Button variant="primary" onClick={onDone}>{C.done}</Button>
            <Button variant="secondary" onClick={() => setStage("calibrate")}>{C.again}</Button>
            {results.length > 0 && <Button variant="ghost" icon={<IconDownload width={16} height={16} />} onClick={download}>{C.download}</Button>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="screen check check-result">
      <div className="check-card">
        <h1 className="heading-xl">{C.title}</h1>
        <p className="paragraph-l fg-2">{C.intro}</p>
        <div className="row gap-3">
          <Button variant="record" size="l" onClick={() => setStage("calibrate")}>{C.start}</Button>
          <Kbd>{t.studio.startHint}</Kbd>
          <Button variant="ghost" onClick={onDone}>{t.common.back}</Button>
        </div>
      </div>
    </main>
  );
}
