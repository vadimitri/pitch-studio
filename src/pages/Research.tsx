// RESEARCH.md rendered as a page, so the sources stay reachable without the (private) repo.
// The file is the single source; this parser knows only what it uses: #, ##, "- " items, [links](), `code`, " → ".
import type { ReactNode } from "react";
import md from "../../RESEARCH.md?raw";
import { useT } from "../i18n";
import { href } from "../lib/router";
import { Footer, Header } from "../ui/Chrome";
import { IconArrowLeft } from "../ui/icons";
import { Tag } from "../ui/primitives";

interface Section { h: string; items: string[] }

function parse(src: string) {
  let title = "";
  const lead: string[] = [];
  const sections: Section[] = [];
  for (const line of src.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")) {
    if (line.startsWith("# ")) title = line.slice(2);
    else if (line.startsWith("## ")) sections.push({ h: line.slice(3), items: [] });
    else if (line.startsWith("- ")) sections.at(-1)?.items.push(line.slice(2));
    else if (line.trim() && !sections.length) lead.push(line.trim());
  }
  return { title, lead: lead.join(" "), sections };
}

const doc = parse(md);

// "Finding. [Source](…) → what we do". Arrows before the source are data ("3.8° → 31°"), not the split;
// lines without a source before the arrow split at the first one.
function split(item: string): [string, string] {
  const link = item.indexOf("](");
  let at = link < 0 ? -1 : item.indexOf(" → ", link);
  if (at < 0) at = item.indexOf(" → ");
  return at < 0 ? [item, ""] : [item.slice(0, at), item.slice(at + 3)];
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(m[1]
      ? <a key={m.index} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>
      : <code key={m.index} className="mono-s">{m[3]}</code>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function Research() {
  const t = useT();
  return (
    <div className="page">
      <Header />
      <main className="page-main">
        <div className="wrap stack research-doc">
          <div className="stack gap-5">
            <a className="row gap-3 label-m research-back" href={href("/")}><IconArrowLeft width={16} height={16} /> {t.research.back}</a>
            <Tag>{t.nav.research}</Tag>
            <h1 className="heading-xxl">{doc.title}</h1>
            <p className="paragraph-l fg-2 section-lead">{inline(doc.lead)}</p>
            {t.research.note && <p className="paragraph-s fg-2">{t.research.note}</p>}
          </div>
          {doc.sections.map((s) => (
            <section key={s.h} className="stack gap-5">
              <h2 className="heading-l">{s.h}</h2>
              <ul className="findings">
                {s.items.map((item) => {
                  const [finding, then] = split(item);
                  return (
                    <li key={item} className="finding">
                      <p className="paragraph-m">{inline(finding)}</p>
                      {then && <p className="paragraph-m fg-2 finding-then">{inline(then)}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
