import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { href } from "../lib/router";
import { Audience, type AudienceHandle } from "../ui/Audience";
import { Footer, Header } from "../ui/Chrome";
import { IconArrowRight, IconLock } from "../ui/icons";
import { KeyVisual } from "../ui/KeyVisual";
import { LinkButton, Tag } from "../ui/primitives";

export function Landing() {
  const t = useT();
  const L = t.landing;
  const aud = useRef<AudienceHandle | null>(null);
  const heroRef = useRef<HTMLElement>(null);

  // The audience watches the cursor: the whole idea of eye contact in one gesture.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const move = (e: PointerEvent) => {
      const box = el.querySelector(".hero-audience")?.getBoundingClientRect();
      if (!box) return;
      const x = (e.clientX - (box.left + box.width / 2)) / (box.width / 2);
      const y = (e.clientY - (box.top + box.height / 2)) / (box.height / 1.2);
      aud.current?.update({ engagement: 0.9, speaking: true, lookAt: { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) } });
      clearTimeout(idle);
      idle = setTimeout(() => aud.current?.update({ engagement: 0.8, speaking: true, lookAt: null }), 1800);
    };
    el.addEventListener("pointermove", move);
    return () => { el.removeEventListener("pointermove", move); clearTimeout(idle); };
  }, []);

  return (
    <div className="landing">
      <section className="hero theme-dark" ref={heroRef}>
        <Header variant="overlay" />
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <Tag tone="outline">{L.kicker}</Tag>
            <h1 className="display-xl hero-title">
              {L.title.map((line, i) => <span key={i} className={i === 1 ? "hero-line accent" : "hero-line"}>{line}</span>)}
            </h1>
            <p className="paragraph-l hero-lead">{L.lead}</p>
            <div className="hero-cta">
              <LinkButton href={href("/studio")} variant="record" size="l" iconRight={<IconArrowRight />}>{L.cta}</LinkButton>
              <a className="hero-secondary label-m" href="#how" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>{L.secondary}</a>
            </div>
            <p className="paragraph-xs fg-3">{L.ctaNote}</p>
          </div>
          <div className="hero-stage">
            <div className="hero-screen">
              <span className="hero-lens" />
              <span className="mono-xs hero-rec"><i /> REC 01:24</span>
            </div>
            <Audience className="hero-audience" count={6} seed={4} onReady={(h) => (aud.current = h)} />
          </div>
        </div>
        <KeyVisual preset="hero" unit="1vw" className="hero-kv" />
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <Tag>{t.nav.how}</Tag>
            <h2 className="heading-xxl">{L.stepsTitle}</h2>
            <p className="paragraph-l fg-2 section-lead">{L.stepsLead}</p>
          </div>
          <ol className="steps">
            {L.steps.map((s, i) => (
              <li key={i} className="step">
                <span className="display-m step-n tnum">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="heading-s">{s.t}</h3>
                <p className="paragraph-m fg-2">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section-gray">
        <div className="wrap">
          <div className="section-head split">
            <div className="stack gap-5">
              <Tag>{t.replay.measures}</Tag>
              <h2 className="heading-xxl">{L.measuresTitle}</h2>
            </div>
            <p className="paragraph-l fg-2 section-lead">{L.measuresLead}</p>
          </div>
          <div className="measure-grid">
            {L.measures.map((m) => (
              <div key={m.k} className="measure">
                <span className="mono-s fg-2">{m.k}</span>
                <span className="heading-s">{m.v}</span>
                <span className="paragraph-s fg-2">{m.d}</span>
              </div>
            ))}
            <div className="measure measure-not theme-dark">
              <span className="mono-s fg-2">{L.notTitle}</span>
              <ul className="not-list">
                {L.not.map((x) => <li key={x} className="paragraph-m">{x}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="research">
        <div className="wrap">
          <div className="section-head split">
            <div className="stack gap-5">
              <Tag>{t.nav.research}</Tag>
              <h2 className="heading-xxl">{L.researchTitle}</h2>
            </div>
            <a className="row gap-3 label-m research-more" href={href("/research")}>
              {L.researchMore} <IconArrowRight width={16} height={16} />
            </a>
          </div>
          <div className="research-grid">
            {L.research.map((r, i) => (
              <figure key={i} className="quote">
                <blockquote className="heading-s">{r.q}</blockquote>
                <figcaption className="mono-xs fg-2">{r.s}</figcaption>
                <span className={`quote-bar quote-bar-${i}`} />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-gray" id="hood">
        <div className="wrap">
          <div className="section-head">
            <Tag>{L.hoodTitle}</Tag>
            <h2 className="heading-xxl">{L.hoodHead}</h2>
          </div>
          <dl className="hood-list">
            {L.hood.map((h) => (
              <div key={h.k} className="hood-item">
                <dt className="mono-s fg-2">{h.k}</dt>
                <dd className="paragraph-m">{h.d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section section-booth theme-dark">
        <div className="wrap booth-grid">
          <figure className="booth-photo">
            <img src="./img/booth.webp" alt={L.boothCaption} loading="lazy" decoding="async" width={900} height={1195} />
            <figcaption className="mono-xs fg-3">{L.boothCaption}</figcaption>
          </figure>
          <div className="stack gap-6 booth-copy">
            <Tag tone="outline">{L.boothTitle}</Tag>
            <h2 className="heading-xxl">{L.boothTitle}</h2>
            <p className="paragraph-xl">{L.boothText}</p>
            <div className="stack gap-5 privacy">
              <h3 className="row gap-3 heading-xs"><IconLock /> {L.privacyTitle}</h3>
              <ul className="privacy-list">
                {L.privacy.map((p) => <li key={p} className="paragraph-m fg-2">{p}</li>)}
              </ul>
            </div>
            <div>
              <LinkButton href={href("/studio")} variant="record" size="l" iconRight={<IconArrowRight />}>{L.cta}</LinkButton>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
