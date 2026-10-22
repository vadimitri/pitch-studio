import { useEffect, useState } from "react";
import { mmss, useT } from "../i18n";
import { href } from "../lib/router";
import { localStore, useSavedVersion, type TakeMeta } from "../lib/takes";
import { Footer, Header } from "../ui/Chrome";
import { IconArrowRight } from "../ui/icons";
import { LinkButton, Tag } from "../ui/primitives";

export function Takes() {
  const t = useT();
  const v = useSavedVersion();
  const [list, setList] = useState<TakeMeta[] | null>(null);
  useEffect(() => {
    localStore.list().then(setList, () => setList([]));
  }, [v]);
  const fmt = new Intl.DateTimeFormat(t.lang === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="page">
      <Header />
      <main className="page-main">
        <div className="wrap stack gap-7">
          <div className="stack gap-4">
            <Tag>{t.takes.stored}</Tag>
            <h1 className="heading-xxl">{t.takes.title}</h1>
          </div>
          {list && list.length === 0 && (
            <div className="empty">
              <p className="paragraph-l fg-2">{t.takes.empty}</p>
              <LinkButton href={href("/studio")} iconRight={<IconArrowRight />}>{t.takes.emptyCta}</LinkButton>
            </div>
          )}
          {list && list.length > 0 && (
            <div className="takes-list">
              {list.map((m) => (
                <a key={m.id} className="take-card" href={href(`/review/${m.id}`)}>
                  {m.poster ? <img className="take-thumb" src={m.poster} alt="" /> : <div className="take-thumb" />}
                  <div className="take-card-body">
                    <span className="heading-xs">{m.title || `${t.briefs[m.settings.brief].label} · ${t.takes.untitled(m.n)}`}</span>
                    <span className="paragraph-s fg-2">{fmt.format(m.createdAt)} · {mmss(m.durationSec)}</span>
                    {m.comments.length > 0 && <span className="mono-xs fg-2">{t.takes.comments(m.comments.length)}</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
