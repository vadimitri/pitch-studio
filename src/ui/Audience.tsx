// Abstract Neo audience: people built from key-visual blocks. Practising in front of an audience beats
// practising alone (Smith & Frymier 2006; Niebuhr & Tegtmeier 2019) and an interactive virtual audience
// helps (Chollet et al. 2015); a hostile one raises anxiety (Pertaub et al. 2002), so "friendly" never
// drops below neutral and "tough" is opt-in. Animated imperatively (refs) to stay off React's render path.
import { useEffect, useRef } from "react";
import type { Accent } from "./KeyVisual";

const ACCENTS: Accent[] = ["green", "lilac", "citrus", "red", "blue", "rose", "peach"];
const LIGHT_HEADS = new Set<Accent>(["citrus", "green", "peach", "rose"]);

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

interface Person {
  el: HTMLDivElement; head: HTMLDivElement; eyes: HTMLDivElement; phone: HTMLDivElement;
  a: number; bias: number; freq: number; phase: number; lag: number;
  gx: number; gy: number; tx: number; ty: number; nextLook: number; nod: number; blinkAt: number;
}

export interface AudienceInput {
  engagement: number; // 0..1
  speaking: boolean;
  /** Where to look, -1..1 (x right, y down) relative to the figures; null = at the speaker (forward). */
  lookAt?: { x: number; y: number } | null;
}

export interface AudienceHandle {
  update(i: AudienceInput): void;
  clap(ms?: number): void;
}

export function Audience({ mode = "friendly", seed = 11, count = 7, rows = 2, className = "", onReady, input }: {
  mode?: "friendly" | "tough";
  seed?: number;
  count?: number; // front row size; back row has count - 1
  rows?: 1 | 2;
  className?: string;
  onReady?: (h: AudienceHandle) => void;
  input?: () => AudienceInput; // polled each frame (alternative to update())
}) {
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const host = root.current!;
    host.innerHTML = "";
    const r = rng(seed * 7919 + 13);
    const people: Person[] = [];
    let prevBody: Accent | null = null;
    for (let row = rows - 1; row >= 0; row--) {
      const n = row === 0 ? count : count - 1;
      const line = document.createElement("div");
      line.className = `aud-row aud-row-${row}`;
      host.appendChild(line);
      for (let i = 0; i < n; i++) {
        let body = ACCENTS[Math.floor(r() * ACCENTS.length)];
        if (body === prevBody) body = ACCENTS[(ACCENTS.indexOf(body) + 3) % ACCENTS.length];
        prevBody = body;
        let headC = ACCENTS[Math.floor(r() * ACCENTS.length)];
        if (headC === body) headC = ACCENTS[(ACCENTS.indexOf(headC) + 2) % ACCENTS.length];
        const dir = r() < 0.5 ? "180deg" : "90deg";
        const el = document.createElement("div");
        el.className = "aud-p";
        const w = 0.86 + r() * 0.28;
        el.style.setProperty("--w", String(w));
        el.innerHTML = `
          <div class="aud-head" style="background:var(--${headC})"><div class="aud-eyes ${LIGHT_HEADS.has(headC) ? "dark" : ""}"><i></i><i></i></div></div>
          <div class="aud-body" style="background:linear-gradient(${dir}, var(--${body}), var(--${body}-tint-80))"></div>
          <div class="aud-phone"></div>`;
        line.appendChild(el);
        people.push({
          el, head: el.querySelector(".aud-head")!, eyes: el.querySelector(".aud-eyes")!, phone: el.querySelector(".aud-phone")!,
          a: 0.7, bias: (r() - 0.5) * 0.3, freq: 0.15 + r() * 0.4, phase: r() * 6, lag: 0.03 + r() * 0.05,
          gx: 0, gy: 0, tx: 0, ty: 0, nextLook: 0, nod: 0, blinkAt: performance.now() + r() * 4000,
        });
      }
    }

    let state: AudienceInput = { engagement: 0.7, speaking: false, lookAt: null };
    let clapUntil = 0;
    onReady?.({ update: (i) => (state = i), clap: (ms = 2200) => (clapUntil = performance.now() + ms) });

    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps is plenty
      last = now;
      if (inputRef.current) state = inputRef.current();
      const t = now / 1000, clapping = now < clapUntil;
      const tough = modeRef.current === "tough";
      const base = tough ? state.engagement : 0.55 + 0.45 * state.engagement;
      for (const p of people) {
        const target = Math.min(1, Math.max(0, base + p.bias + 0.1 * Math.sin(t * p.freq + p.phase)));
        p.a += (target - p.a) * p.lag;
        const attentive = clapping || p.a > 0.62;
        const distracted = !clapping && p.a < 0.36;
        const phone = distracted && tough;

        if (now > p.nextLook) {
          p.nextLook = now + 700 + Math.random() * 2600;
          if (state.lookAt) { p.tx = state.lookAt.x; p.ty = state.lookAt.y; }
          else if (attentive) { p.tx = 0; p.ty = 0; }
          else { p.tx = Math.random() < 0.5 ? -1 : 1; p.ty = Math.random() * 0.4; }
          if (phone) { p.tx = 0; p.ty = 1; }
          if (attentive && state.speaking && Math.random() < 0.3) p.nod = now + 520;
        }
        if (state.lookAt && !phone) { p.tx = state.lookAt.x; p.ty = state.lookAt.y; }
        p.gx += (p.tx - p.gx) * 0.25;
        p.gy += (p.ty - p.gy) * 0.25;

        const nodY = p.nod > now ? Math.sin(((520 - (p.nod - now)) / 520) * Math.PI * 2) * 0.06 : 0;
        const slump = phone ? 0.12 : distracted ? 0.05 : 0;
        const hop = clapping ? Math.abs(Math.sin(t * 9 + p.phase * 4)) * -0.08 : 0;
        p.head.style.transform = `translate(${p.gx * 0.05}em, ${nodY + slump + hop}em)`;
        const blink = now > p.blinkAt && now < p.blinkAt + 120;
        if (now > p.blinkAt + 120) p.blinkAt = now + 2200 + Math.random() * 4500;
        p.eyes.style.transform = `translate(${p.gx * 0.07}em, ${p.gy * 0.08}em) scaleY(${blink || phone ? 0.25 : 1})`;
        p.el.style.opacity = String(0.45 + 0.55 * Math.min(1, p.a + 0.25));
        p.el.style.filter = distracted ? "saturate(0.25)" : "none";
        p.el.style.transform = `translateY(${hop * 0.5}em) scale(${attentive ? 1.03 : 1})`;
        p.phone.style.opacity = phone ? "1" : "0";
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seed, count, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={root} className={`audience ${className}`} aria-hidden="true" />;
}
