// Replay: the whole take from 0:00, unmirrored, started by you (big play button, Space, click; the booth plays
// on its own). Beside it the four measures, one of them marked for the next take, and the transcript.
import { useEffect, useRef } from "react";
import { cardLabel, cardTimes } from "../lib/host";
import { mmss, useT } from "../i18n";
import type { Take } from "../lib/types";
import { IconAgain, IconCheck, IconCompare, IconShare, IconSliders, IconTrash } from "../ui/icons";
import { DemoNote } from "../ui/DemoNote";
import { DetectionOverlay, DetectionToggle, hasDetection, lookLabels } from "../ui/DetectionOverlay";
import { Lanes } from "../ui/Lanes";
import { Measures } from "../ui/Measures";
import { Player, usePlayerTime, type Marker, type PlayerApi } from "../ui/Player";
import { Kbd, Tag } from "../ui/primitives";
import { Transcript } from "../ui/Transcript";
import { useCoaching } from "./analysis";
import { engineState } from "./engine";
import { GestureRing, type HandGesture } from "./GestureRing";
import { blobUrl } from "./media-helpers";

/** Live call: the commentated clip, muted, following the replay (play, pause, seek, speed). */
function ClipSync({ url, offset, video }: { url: string; offset: number; video: HTMLVideoElement }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const sync = () => {
      const want = video.currentTime - offset;
      const end = Number.isFinite(c.duration) ? c.duration : Infinity;
      if (want < 0 || want > end) {
        if (!c.paused) c.pause();
        const edge = want < 0 ? 0 : end;
        if (Number.isFinite(edge) && Math.abs(c.currentTime - edge) > 0.05) c.currentTime = edge;
        return;
      }
      if (Math.abs(c.currentTime - want) > 0.25) c.currentTime = want;
      c.playbackRate = video.playbackRate;
      if (video.paused) { if (!c.paused) c.pause(); } else if (c.paused) void c.play().catch(() => {});
    };
    const events = ["play", "pause", "seeked", "timeupdate", "ratechange"];
    events.forEach((e) => video.addEventListener(e, sync));
    sync();
    return () => { events.forEach((e) => video.removeEventListener(e, sync)); c.pause(); };
  }, [url, offset, video]);
  return <video ref={ref} className="replay-clip" src={url} muted playsInline preload="auto" />;
}

/** Host mode: time on each cue card against its budget; click jumps to where the card came up. */
function HostCards({ take, onSeek }: { take: Take; onSeek: (s: number) => void }) {
  const t = useT();
  const cards = take.host?.cards;
  if (!cards) return null;
  const { used, first } = cardTimes(cards.marks, take.durationSec, cards.list.length);
  return (
    <section className="host-cards">
      <h2 className="mono-xs fg-2">{t.host.cardsTitle}</h2>
      <ol>
        {cards.list.map((c, i) => {
          const at = first[i];
          const over = c.budget != null && used[i] > c.budget * 1.1;
          return (
            <li key={i}>
              <button disabled={at == null} onClick={() => at != null && onSeek(at)}>
                <span className="mono-xs fg-3 tnum">{String(i + 1).padStart(2, "0")}</span>
                <span className="label-s host-card-title">{cardLabel(c)}</span>
                <span className={`mono-xs tnum ${over ? "over" : "fg-2"}`}>
                  {at == null ? t.host.notReached : mmss(used[i])}{c.budget != null ? ` / ${mmss(c.budget)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Replay({ take, prev, video, clipUrl, booth, gestures, deleteArmed, onAgain, onCompare, onShare, onDelete, onSetup }: {
  take: Take; prev: Take | null; video: HTMLVideoElement; clipUrl?: string; booth: boolean; gestures: boolean; deleteArmed: boolean;
  onAgain: () => void; onCompare: () => void; onShare: () => void; onDelete: () => void; onSetup: () => void;
}) {
  const t = useT();
  const R = t.replay;
  const c = useCoaching(take, prev);
  const time = usePlayerTime();
  const api = useRef<PlayerApi | null>(null);
  const src = blobUrl(take.video);
  const pending = take.analysis.status === "transcribing";
  const takesInRow = engineState.get().takes.length;

  const markers: Marker[] = (c.m.speech?.fillers.items ?? []).map((f) => ({ t: f.t, kind: "filler" as const }));
  const tip = t.tips[c.focus.tip as keyof typeof t.tips];
  const seek = (s: number) => api.current?.seek(s, true);
  const g = (name: HandGesture) => (gestures ? <GestureRing name={name} size={booth ? 30 : 24} /> : null);

  return (
    <main className="screen replay">
      <section className="replay-main">
        <div className="replay-head">
          <h1 className="heading-s">{R.take(take.n)} <span className="fg-3">· {t.briefs[take.settings.brief].label} · {mmss(take.durationSec)}</span></h1>
          <div className="row gap-3">
            {take.prediction && <Tag tone="outline">{R.you[take.prediction]}</Tag>}
            {take.saved && <Tag tone="inverse"><IconCheck width={12} height={12} /> {R.shared}</Tag>}
          </div>
        </div>
        <Player key={take.id} video={video} src={src} duration={take.durationSec} markers={markers} time={time}
          autoPlay={booth} onApi={(a) => (api.current = a)} keys={!booth}
          overlay={hasDetection(take.timeline) && <DetectionOverlay timeline={take.timeline} look={c.m.look} labels={lookLabels(t)} />}
          corner={hasDetection(take.timeline) && <DetectionToggle label={R.detection} />} />
        <Lanes timeline={take.timeline} metrics={c.m} words={take.analysis.transcript?.words ?? null} duration={take.durationSec} time={time} onSeek={seek}
          sections={take.host?.cards?.marks.map((m) => m.t)} />
        <div className="moments">
          {take.host?.mishap && (
            <button className="moment mishap" onClick={() => seek(Math.max(0, take.host!.mishap!.t - 1))} title={take.host.mishap.text}>
              <span className="mono-xs tnum fg-3">{mmss(take.host.mishap.t)}</span> {t.host.mishapMoment}: {take.host.mishap.text}
            </button>
          )}
          {c.moments.map((mo) => (
            <button key={mo.key + mo.t} className={`moment ${mo.key}`} onClick={() => seek(mo.t)}>
              <span className="mono-xs tnum fg-3">{mmss(mo.t)}</span> {R.moments[mo.key as keyof typeof R.moments] ?? mo.key}
            </button>
          ))}
        </div>
      </section>

      <aside className="replay-side">
        <DemoNote k="replay" />
        {clipUrl && take.host?.clip && <ClipSync url={clipUrl} offset={take.host.clip.offset} video={video} />}
        <HostCards take={take} onSeek={seek} />
        <Measures m={c.m} prev={c.prevM} pending={pending} focus={{ key: c.focus.key, tip }} />
        {c.focus.key === "vary" && <p className="next-line"><span className="mono-xs">{R.next}</span> <span className="label-s">{tip}</span></p>}
        {takesInRow >= 3 && take.n === engineState.get().takes.at(-1)?.n && takesInRow % 3 === 0 && <p className="paragraph-xs fg-3">{R.pauseHint}</p>}
        <Transcript analysis={take.analysis} metrics={c.m} time={time} onSeek={seek} lang={take.settings.speechLang} />
      </aside>

      <footer className="replay-actions">
        <button className="act act-primary" onClick={onAgain}><IconAgain /> <span>{R.again}</span> {booth ? <Kbd>●</Kbd> : <Kbd>Enter</Kbd>} {g("Open_Palm")}</button>
        <button className="act act-share" onClick={onShare}><IconShare /> <span>{take.saved ? R.shared : R.share}</span> <Kbd>S</Kbd> {g("Thumb_Up")}</button>
        <button className="act" onClick={onCompare} disabled={!prev}><IconCompare /> <span>{R.compare}</span> <Kbd>C</Kbd> {g("Victory")}</button>
        <button className={`act act-danger ${deleteArmed ? "armed" : ""}`} onClick={onDelete}><IconTrash /> <span>{deleteArmed ? R.deleteConfirm : R.delete}</span> <Kbd>D</Kbd> {g("Thumb_Down")}</button>
        <span className="grow" />
        <button className="act" onClick={onSetup}><IconSliders /> <span>{R.setup}</span> <Kbd>Esc</Kbd></button>
      </footer>
    </main>
  );
}
