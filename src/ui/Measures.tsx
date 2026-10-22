// Measure cards: behaviour as a value, a range from studies and the change against the last take.
// Never a grade (Kluger & DeNisi 1996). Estimates are labelled as such. The card picked for the next take
// carries the one short tip (one focus per take: Fukkink et al. 2011).
import { fmtNum, mmss, useT, type Dict } from "../i18n";
import { BANDS, type Metrics } from "../lib/analysis/metrics";
import type { UiLang } from "../lib/types";

interface Card {
  key: string; label: string; value: string; unit?: string; sub?: string; note?: string; delta?: string;
  band?: { min: number; max: number; lo: number; hi: number; v: number }; stack?: { pct: number; color: string }[]; pending?: boolean; est?: boolean;
}

function delta(t: Dict & { lang: UiLang }, cur: number | null | undefined, prev: number | null | undefined, d = 1, unit = ""): string | undefined {
  if (cur == null || prev == null) return undefined;
  const diff = cur - prev;
  if (Math.abs(diff) < 10 ** -d / 2) return t.replay.metric.same;
  return t.replay.metric.delta(`${diff > 0 ? "▲" : "▼"} ${fmtNum(t.lang, Math.abs(diff), d)}${unit}`);
}

export function buildCards(t: Dict & { lang: UiLang }, m: Metrics, prev: Metrics | null, pending: boolean): Card[] {
  const M = t.replay.metric;
  const cards: Card[] = [];
  const g = m.gaze;
  const gazeOk = g.facePct >= 40;
  cards.push({
    key: "gaze", label: M.gaze, value: gazeOk ? `${g.cameraPct}` : "–", unit: gazeOk ? "%" : undefined, est: true,
    sub: gazeOk ? M.gazeSub(g.downPct, g.screenPct) : undefined,
    note: !gazeOk ? M.gazeNoFace : g.longestAway && g.longestAway.dur >= 5 ? M.gazeAway(Math.round(g.longestAway.dur), mmss(g.longestAway.s)) : g.calibrated ? M.gazeNote : M.gazeUncal,
    delta: gazeOk ? delta(t, g.cameraPct, prev?.gaze.cameraPct, 0, " %") : undefined,
    stack: gazeOk ? [
      { pct: g.cameraPct, color: "var(--green)" }, { pct: g.screenPct, color: "var(--blue)" },
      { pct: g.downPct, color: "var(--peach)" }, { pct: g.awayPct, color: "var(--lilac)" },
    ] : undefined,
  });
  const s = m.speech;
  if (s) {
    cards.push({
      key: "pace", label: M.pace, value: fmtNum(t.lang, s.sylPerSec), unit: M.paceUnit, sub: M.paceSub(s.wpm), note: M.paceNote,
      delta: delta(t, s.sylPerSec, prev?.speech?.sylPerSec), band: { min: 1, max: 7, lo: BANDS.sylPerSec[0], hi: BANDS.sylPerSec[1], v: s.sylPerSec },
    });
    cards.push({
      key: "fillers", label: M.fillers, value: fmtNum(t.lang, s.fillers.perMin), unit: M.fillersUnit, est: s.fillers.estimated,
      sub: [M.fillersSub(s.fillers.count), s.soft.length ? M.soft(s.soft.map((x) => `„${x.w}“ ${x.count}×`).join(", ")) : ""].filter(Boolean).join(" · "),
      note: s.fillers.estimated ? M.fillersEst : M.fillersNote, delta: delta(t, s.fillers.perMin, prev?.speech?.fillers.perMin),
      band: { min: 0, max: 15, lo: 0, hi: BANDS.fillersPerMin, v: s.fillers.perMin },
    });
  } else {
    for (const key of ["pace", "fillers"] as const) cards.push({ key, label: M[key], value: pending ? "…" : "–", note: pending ? M.pending : M.none, pending });
  }
  const d = m.duration;
  const over = d.target ? Math.round(d.sec - d.target) : 0;
  cards.push({
    key: "time", label: M.time, value: mmss(d.sec), sub: d.target ? M.target(mmss(d.target)) : undefined,
    note: !d.ratio ? undefined : Math.abs(d.ratio - 1) <= BANDS.durationTol ? M.onTarget : over > 0 ? M.over(over) : M.under(-over),
    delta: delta(t, d.sec, prev?.duration.sec, 0, " s"),
    band: d.target ? { min: 0, max: d.target * 1.6, lo: d.target * (1 - BANDS.durationTol), hi: d.target * (1 + BANDS.durationTol), v: d.sec } : undefined,
  });
  return cards;
}

export function Measures({ m, prev, pending, focus }: { m: Metrics; prev: Metrics | null; pending: boolean; focus?: { key: string; tip: string } }) {
  const t = useT();
  const cards = buildCards(t, m, prev, pending);
  return (
    <div className="measures">
      {cards.map((c) => {
        const next = focus?.key === c.key;
        return (
          <div key={c.key} className={`mcard ${c.pending ? "pending" : ""} ${next ? "focus" : ""}`}>
            <span className="mono-xs fg-2 mcard-label">{c.label}{c.est && <span className="est"> · {t.common.estimate}</span>}</span>
            <span className="mcard-value"><span className="heading-l tnum">{c.value}</span>{c.unit && <span className="label-s fg-2"> {c.unit}</span>}</span>
            {c.band && <RangeBar {...c.band} />}
            {c.stack && <StackBar parts={c.stack} />}
            {c.sub && <span className="paragraph-xs mcard-sub">{c.sub}</span>}
            {c.note && <span className="paragraph-xs fg-3">{c.note}</span>}
            {c.delta && <span className="mono-xs mcard-delta">{c.delta}</span>}
            {next && <span className="mcard-next"><span className="mono-xs">{t.replay.next}</span> <span className="label-s">{focus.tip}</span></span>}
          </div>
        );
      })}
    </div>
  );
}

function RangeBar({ min, max, lo, hi, v }: { min: number; max: number; lo: number; hi: number; v: number }) {
  const p = (x: number) => `${Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100))}%`;
  return (
    <span className="range">
      <span className="range-band" style={{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})` }} />
      <span className="range-dot" style={{ left: p(v) }} />
    </span>
  );
}

function StackBar({ parts }: { parts: { pct: number; color: string }[] }) {
  return (
    <span className="stackbar">
      {parts.filter((x) => x.pct > 0).map((x, i) => <span key={i} style={{ width: `${x.pct}%`, background: x.color }} />)}
    </span>
  );
}
