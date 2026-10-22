// Review page (Vimeo-like): video, timestamped reactions and notes at the moment they refer to, transcript.
// Peer feedback gets used when it names the place and a fix (Nelson & Schunn 2009), so every note sits on a
// timestamp and the typed kinds are keep / change / try. Owner view adds measures; reviewer view hides them.
// "Add example notes" drops four labelled notes on real moments of the take, so a demo shows the annotated page.
import { useEffect, useMemo, useRef, useState } from "react";
import { mmss, useT } from "../i18n";
import { extFor } from "../lib/media/recorder";
import { href, navigate } from "../lib/router";
import { localStore, uid } from "../lib/takes";
import type { Comment, CommentKind, Take } from "../lib/types";
import { keyMoments, type Metrics } from "../lib/analysis/metrics";
import { analyse } from "../studio/analysis";
import { blobUrl, downloadBlob } from "../studio/media-helpers";
import { Footer, Header } from "../ui/Chrome";
import { DemoNote } from "../ui/DemoNote";
import { DetectionOverlay, DetectionToggle, hasDetection, lookLabels } from "../ui/DetectionOverlay";
import { IconArrowRight, IconDownload, IconTrash } from "../ui/icons";
import { Lanes } from "../ui/Lanes";
import { Measures } from "../ui/Measures";
import { Player, usePlayerTime, type Marker, type PlayerApi } from "../ui/Player";
import { Button, LinkButton, Segmented, Tag } from "../ui/primitives";
import { Transcript } from "../ui/Transcript";
import "../styles/studio.css";
import "../styles/review.css";

const QUICK: CommentKind[] = ["lands", "lost", "drags"];
const TYPED: CommentKind[] = ["keep", "change", "try"];

/** Example notes on moments the analysis found (filler cluster, long pause, looking away), else at fixed shares. */
function exampleNotes(m: Metrics, dur: number, text: Record<"open" | "lost" | "drags" | "end", string>, author: string): Comment[] {
  const km = keyMoments(m);
  const rough = km.find((k) => k.key === "fillerCluster" || k.key === "hang" || k.key === "away");
  const at = (x: number) => Math.round(Math.max(0, Math.min(dur - 0.5, x)) * 10) / 10;
  const now = Date.now();
  const n = (t: number, kind: CommentKind, body: string): Comment => ({ id: uid(), t: at(t), kind, text: body, author, at: now, example: true });
  return [
    n(Math.min(4, dur * 0.1), "lands", text.open),
    n(rough ? rough.t + 1 : dur * 0.4, "lost", text.lost),
    n(dur * 0.65, "drags", text.drags),
    n(dur - Math.min(6, dur * 0.1), "try", text.end),
  ].sort((a, b) => a.t - b.t);
}

export default function Review({ id, query }: { id: string; query: URLSearchParams }) {
  const t = useT();
  const V = t.review;
  const [take, setTake] = useState<Take | null | undefined>(undefined);
  const [view, setView] = useState<"owner" | "reviewer">(query.get("view") === "reviewer" ? "reviewer" : "owner");
  const [kind, setKind] = useState<CommentKind>("change");
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);
  const time = usePlayerTime();
  const api = useRef<PlayerApi | null>(null);

  useEffect(() => { localStore.get(id).then(setTake, () => setTake(null)); }, [id]);
  useEffect(() => time.subscribe(() => {
    const v = api.current?.video;
    if (v?.paused) setAt(time.get()); // the note goes where you paused
  }), [time]);

  const m = useMemo(() => (take ? analyse(take) : null), [take]);
  const fmt = new Intl.DateTimeFormat(t.lang === "de" ? "de-DE" : "en-GB", { dateStyle: "long", timeStyle: "short" });

  if (take === undefined) return <div className="page"><Header /><main className="page-main" /></div>;
  if (take === null || !m) {
    return (
      <div className="page">
        <Header />
        <main className="page-main"><div className="wrap empty">
          <h1 className="heading-xl">{V.notFound}</h1>
          <p className="paragraph-l fg-2">{V.notFoundHint}</p>
          <div className="row gap-3">
            <LinkButton href={href("/studio")} variant="record" iconRight={<IconArrowRight width={16} height={16} />}>{V.recordOwn}</LinkButton>
            <LinkButton href={href("/takes")} variant="secondary">{t.takes.title}</LinkButton>
          </div>
        </div></main>
        <Footer />
      </div>
    );
  }

  const save = async (next: Take) => { setTake(next); await localStore.put(next); };
  const addComment = async (k: CommentKind, body?: string) => {
    const tt = api.current ? api.current.video.currentTime : at;
    const c: Comment = { id: uid(), t: Math.round(tt * 10) / 10, kind: k, text: body?.trim() || undefined, author: V.you, at: Date.now() };
    await save({ ...take, comments: [...take.comments, c].sort((a, b) => a.t - b.t) });
  };
  const removeComment = (cid: string) => save({ ...take, comments: take.comments.filter((c) => c.id !== cid) });
  const markers: Marker[] = take.comments.map((c) => ({ t: c.t, kind: "comment", label: c.text ?? V.reactions[c.kind] }));
  const owner = view === "owner";
  const hasExamples = take.comments.some((c) => c.example);

  return (
    <div className="page review-page">
      <Header />
      <section className="review-stage theme-dark">
        <div className="wrap stack gap-5">
          <div className="review-title-row">
            <input className="review-title heading-l" value={take.title ?? ""} placeholder={`${t.briefs[take.settings.brief].label} · ${t.takes.untitled(take.n)}`}
              onChange={(e) => setTake({ ...take, title: e.target.value })} onBlur={() => void save(take)} aria-label={V.titlePlaceholder} />
            <Segmented size="s" value={view} onChange={setView} label="View"
              options={[{ value: "owner", label: V.ownerView }, { value: "reviewer", label: V.reviewerView }]} />
          </div>
          <p className="paragraph-s fg-2">{V.recorded(fmt.format(take.createdAt))} · {mmss(take.durationSec)}{!owner && <> · {V.reviewerHint}</>}</p>
          <DemoNote k="review" />
          <div className="review-grid">
            <div className="stack gap-4 review-media">
              <Player src={blobUrl(take.video)} duration={take.durationSec} time={time} markers={markers} autoPlay={false} onApi={(a) => (api.current = a)}
                overlay={owner && hasDetection(take.timeline) && <DetectionOverlay timeline={take.timeline} look={m.look} labels={lookLabels(t)} />}
                corner={owner && hasDetection(take.timeline) && <DetectionToggle label={t.replay.detection} />} />
              {owner && <Lanes timeline={take.timeline} metrics={m} words={take.analysis.transcript?.words ?? null} duration={take.durationSec} time={time}
                onSeek={(s) => api.current?.seek(s)} comments={take.comments} />}
              <div className="composer">
                <span className="mono-xs fg-2">{V.addNote} <span className="tnum">{mmss(at)}</span></span>
                <div className="row gap-2 composer-quick">
                  {QUICK.map((k) => (
                    <button key={k} className={`quick quick-${k}`} onClick={() => void addComment(k)}><i className="kind-dot" /> {V.reactions[k]}</button>
                  ))}
                </div>
                <form className="composer-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void addComment(kind, text); setText(""); } }}>
                  <Segmented size="s" value={kind} onChange={setKind} label="Kind" options={TYPED.map((k) => ({ value: k, label: V.reactions[k] }))} />
                  <div className="row gap-2">
                    <input className="composer-input paragraph-m" value={text} onChange={(e) => setText(e.target.value)}
                      placeholder={V.notePlaceholder[kind as "keep" | "change" | "try"]} onFocus={() => api.current?.pause()} />
                    <Button type="submit" variant="primary" size="m" disabled={!text.trim()}>{t.common.save}</Button>
                  </div>
                </form>
              </div>
            </div>
            <aside className="notes">
              <h2 className="mono-xs fg-2">{V.notes} · {take.comments.length}</h2>
              {take.comments.length === 0 && <p className="paragraph-s fg-3">{V.noNotes}</p>}
              {!hasExamples && (
                <button className="btn btn-secondary btn-s examples-btn"
                  onClick={() => void save({ ...take, comments: [...take.comments, ...exampleNotes(m, take.durationSec, V.exampleText, V.exampleAuthor)].sort((a, b) => a.t - b.t) })}>
                  {V.examples}
                </button>
              )}
              <ol className="note-list">
                {take.comments.map((c) => (
                  <li key={c.id} className={`note note-${c.kind}`}>
                    <button className="note-time mono-xs tnum" onClick={() => api.current?.seek(c.t, true)}>{mmss(c.t)}</button>
                    <div className="note-body">
                      <span className="label-s note-kind"><i className="kind-dot" /> {V.reactions[c.kind]}{c.author && c.author !== V.you && <span className="mono-xs fg-3"> · {c.author}</span>}</span>
                      {c.text && <p className="paragraph-s">{c.text}</p>}
                    </div>
                    <button className="note-del" onClick={() => void removeComment(c.id)} aria-label={t.common.delete}><IconTrash width={14} height={14} /></button>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </div>
      </section>

      <section className="review-body">
        <div className="wrap review-body-grid">
          <Transcript analysis={take.analysis} metrics={m} time={time} onSeek={(s) => api.current?.seek(s, true)} lang={take.settings.speechLang} />
          {owner && <div className="stack gap-3"><h2 className="mono-xs fg-2">{t.replay.measures}</h2><Measures m={m} prev={null} pending={false} /></div>}
          {owner && <div className="share-box">
            <Tag>{V.shareTitle}</Tag>
            <p className="paragraph-m fg-2">{V.shareText}</p>
            <div className="row gap-3" style={{ flexWrap: "wrap" }}>
              <Button variant="primary" icon={<IconDownload width={16} height={16} />} onClick={() => downloadBlob(take.video, `pitch-studio-take-${take.n}.${extFor(take.mime)}`)}>{t.common.download}</Button>
              <Button variant="ghost" icon={<IconTrash width={16} height={16} />} onClick={async () => {
                if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); return; }
                await localStore.remove(take.id);
                navigate("/takes");
              }}>{confirmDel ? V.deleteConfirm : V.deleteTake}</Button>
            </div>
          </div>}
        </div>
      </section>
      <Footer />
    </div>
  );
}
