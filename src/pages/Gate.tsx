// A friendly door for the demo, not security: the site is static and public, the check runs in the browser. Wrong
// guesses make the audience lose interest, the right one gets applause. Remembered per browser; the booth skips it.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Audience, type AudienceHandle } from "../ui/Audience";
import { LangToggle } from "../ui/Chrome";
import { IconArrowRight } from "../ui/icons";
import { KeyVisual } from "../ui/KeyVisual";
import { Button, EngineLogo, Tag } from "../ui/primitives";

const KEY = "ps.gate";
const HASH = "cd6ebc9573d659ef72515bb65d7080ec23d11833f98762921a59da9641482e9b"; // sha-256 of the password (lowercase, no spaces)

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isUnlocked(): boolean {
  try { return localStorage.getItem(KEY) === HASH; } catch { return false; }
}

export function Gate({ onUnlock }: { onUnlock: () => void }) {
  const t = useT();
  const G = t.gate;
  const [value, setValue] = useState("");
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<"idle" | "wrong" | "ok">("idle");
  const aud = useRef<AudienceHandle | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    // the audience watches the field; every wrong guess costs some attention
    aud.current?.update({ engagement: Math.max(0.05, 0.85 - tries * 0.22), speaking: value.length > 0, lookAt: { x: 0, y: 0.6 } });
  }, [tries, value]);

  const submit = async () => {
    if (!value.trim() || state === "ok") return;
    const ok = (await sha256(value.trim().toLowerCase().replace(/\s+/g, ""))) === HASH;
    if (ok) {
      setState("ok");
      aud.current?.update({ engagement: 1, speaking: true, lookAt: null });
      aud.current?.clap(1600);
      try { localStorage.setItem(KEY, HASH); } catch { /* private mode: asks again next time */ }
      setTimeout(onUnlock, 1300);
    } else {
      setTries((n) => n + 1);
      setState("wrong");
      setTimeout(() => setState("idle"), 500);
      setValue("");
    }
  };

  const msg = state === "ok" ? G.ok : tries === 0 ? G.hint : G.wrong[Math.min(tries - 1, G.wrong.length - 1)];
  return (
    <div className="gate theme-dark">
      <header className="gate-head">
        <span className="brand"><EngineLogo height={28} /><span className="brand-sep" /><span className="brand-name">Pitch Studio</span></span>
        <LangToggle />
      </header>
      <main className="gate-main">
        <Tag tone="outline">{G.kicker}</Tag>
        <h1 className="display-l">{G.title}</h1>
        <p className={`paragraph-l gate-msg ${state}`} aria-live="polite">{msg}</p>
        <form className={`gate-form ${state}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input ref={input} className="gate-input heading-s" type="password" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={G.placeholder} aria-label={G.placeholder} autoComplete="off" disabled={state === "ok"} />
          <Button type="submit" variant="record" size="l" iconRight={<IconArrowRight />} disabled={state === "ok"}>{G.enter}</Button>
        </form>
        <Audience className="gate-audience" count={6} rows={1} seed={4} onReady={(h) => (aud.current = h)} />
      </main>
      <KeyVisual preset="footer" side="right" unit="0.8vw" className="gate-kv" />
    </div>
  );
}
