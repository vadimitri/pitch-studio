// Phones and tablets get one honest screen: the demo needs a laptop camera, a keyboard and laptop horsepower.
import { useT } from "../i18n";
import { LangToggle } from "../ui/Chrome";
import { KeyVisual } from "../ui/KeyVisual";
import { EngineLogo, Tag } from "../ui/primitives";

/** Phone or tablet (iPadOS reports itself as a Mac, but with touch points). */
export const isMobile = () =>
  /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function LaptopOnly() {
  const t = useT();
  const M = t.mobileOnly;
  return (
    <div className="gate theme-dark">
      <header className="gate-head">
        <span className="brand"><EngineLogo height={24} /><span className="brand-sep" /><span className="brand-name">Pitch Studio</span></span>
        <LangToggle />
      </header>
      <main className="gate-main">
        <Tag tone="outline">{M.kicker}</Tag>
        <h1 className="display-m">{M.title}</h1>
        <p className="paragraph-l fg-2">{M.text}</p>
        <p className="paragraph-s fg-3">{M.sorry}</p>
      </main>
      <KeyVisual preset="footer" side="right" unit="2vw" className="gate-kv" />
    </div>
  );
}
