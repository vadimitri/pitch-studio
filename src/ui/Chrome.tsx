// Site header and footer for the light pages (landing, takes, review).
import { setLang, useT } from "../i18n";
import { settingsStore } from "../studio/settings";
import { href } from "../lib/router";
import { NotesToggle } from "./DemoNote";
import { IconArrowRight } from "./icons";
import { KeyVisual } from "./KeyVisual";
import { EngineLogo, LinkButton } from "./primitives";

export function LangToggle({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <button className={`lang-toggle ${className}`} aria-label={t.meta.other}
      onClick={() => { const next = t.lang === "en" ? "de" : "en"; setLang(next); settingsStore.patch({ speechLang: next }); }}>
      <span className={t.lang === "en" ? "on" : ""}>EN</span>
      <span className={t.lang === "de" ? "on" : ""}>DE</span>
    </button>
  );
}

export function Header({ variant = "light" }: { variant?: "light" | "overlay" }) {
  const t = useT();
  return (
    <header className={`site-header site-header-${variant}`}>
      <div className="site-header-in">
        <a href={href("/")} className="brand" aria-label="Pitch Studio · HPI Engine">
          <EngineLogo height={30} />
          <span className="brand-sep" />
          <span className="brand-name">Pitch Studio</span>
        </a>
        <nav className="site-nav">
          <a className="btn btn-nav nav-hide-s" href={href("/research")}>{t.nav.research}</a>
          <a className="btn btn-nav nav-hide-s" href={href("/takes")}>{t.nav.takes}</a>
          <NotesToggle />
          <LangToggle />
          <LinkButton href={href("/studio")} variant={variant === "overlay" ? "record" : "primary"} size="s" iconRight={<IconArrowRight width={16} height={16} />}>
            {t.nav.open}
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  const t = useT();
  return (
    <footer className="site-footer theme-dark">
      <div className="wrap footer-grid">
        <div className="stack gap-5">
          <EngineLogo height={40} />
          <p className="paragraph-s fg-2" style={{ maxWidth: 360 }}>{t.landing.footerNote}</p>
        </div>
        <div className="footer-credit">
          <span className="label-s fg-3">{t.landing.madeBy}</span>
          <a className="heading-s footer-name" href="https://github.com/vadimitri" target="_blank" rel="noreferrer">vadimitri</a>
          <a className="paragraph-s fg-2 footer-link" href={href("/research")}>{t.nav.research}</a>
        </div>
      </div>
      <KeyVisual preset="footer" side="right" unit="0.8vw" className="footer-kv" />
    </footer>
  );
}
