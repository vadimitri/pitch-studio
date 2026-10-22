// Two takes side by side, played in sync (seeing the change is the point of a second take).
import { useEffect, useRef, useState } from "react";
import { fmtNum, mmss, useT } from "../i18n";
import type { Take } from "../lib/types";
import { IconArrowLeft, IconPause, IconPlay } from "../ui/icons";
import { Player, usePlayerTime, type PlayerApi } from "../ui/Player";
import { analyse } from "./analysis";
import { blobUrl } from "./media-helpers";

export function Compare({ a, b, onBack }: { a: Take; b: Take; onBack: () => void }) {
  const t = useT();
  const R = t.replay, M = R.metric;
  const pa = useRef<PlayerApi | null>(null), pb = useRef<PlayerApi | null>(null);
  const ta = usePlayerTime(), tb = usePlayerTime();
  const [playing, setPlaying] = useState(false);
  const ma = analyse(a), mb = analyse(b);

  // keep A within 0.3 s of B
  useEffect(() => tb.subscribe(() => {
    const A = pa.current, B = pb.current;
    if (!A || !B) return;
    const tt = tb.get();
    if (tt < a.durationSec && Math.abs(A.video.currentTime - tt) > 0.3) A.video.currentTime = tt;
  }), [tb, a.durationSec]);

  const toggle = () => {
    const A = pa.current, B = pb.current;
    if (!A || !B) return;
    if (B.video.paused) { B.play(); A.play(); setPlaying(true); } else { B.pause(); A.pause(); setPlaying(false); }
  };

  const rows: { k: string; a: string; b: string; better?: boolean | null }[] = [
    { k: M.time, a: mmss(ma.duration.sec), b: mmss(mb.duration.sec) },
    { k: M.gaze, a: `${ma.gaze.cameraPct} %`, b: `${mb.gaze.cameraPct} %` },
    { k: M.pace, a: ma.speech ? `${fmtNum(t.lang, ma.speech.sylPerSec)} ${M.paceUnit}` : "–", b: mb.speech ? `${fmtNum(t.lang, mb.speech.sylPerSec)} ${M.paceUnit}` : "–" },
    { k: M.fillers, a: ma.speech ? `${fmtNum(t.lang, ma.speech.fillers.perMin)}${M.fillersUnit}` : "–", b: mb.speech ? `${fmtNum(t.lang, mb.speech.fillers.perMin)}${M.fillersUnit}` : "–" },
  ];

  return (
    <main className="screen compare">
      <div className="compare-head">
        <button className="btn btn-ghost btn-s" onClick={onBack}><IconArrowLeft width={16} height={16} /> {t.common.back}</button>
        <h1 className="heading-s">{R.compareTitle(a.n, b.n)}</h1>
        <button className="btn btn-primary btn-s" onClick={toggle}>{playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />} {playing ? R.pause : R.play}</button>
      </div>
      <div className="compare-grid">
        <div className="stack gap-3">
          <span className="mono-xs fg-2">{R.take(a.n)}</span>
          <Player src={blobUrl(a.video)} duration={a.durationSec} time={ta} autoPlay={false} muted keys={false} onApi={(x) => (pa.current = x)} />
        </div>
        <div className="stack gap-3">
          <span className="mono-xs fg-2">{R.take(b.n)}</span>
          <Player src={blobUrl(b.video)} duration={b.durationSec} time={tb} autoPlay={false} keys={false} onApi={(x) => (pb.current = x)} />
        </div>
      </div>
      <table className="compare-table">
        <thead><tr><th /><th className="mono-xs fg-2">{R.take(a.n)}</th><th className="mono-xs fg-2">{R.take(b.n)}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.k}><td className="mono-xs fg-2">{r.k}</td><td className="tnum">{r.a}</td><td className="tnum label-m">{r.b}</td></tr>)}</tbody>
      </table>
    </main>
  );
}
