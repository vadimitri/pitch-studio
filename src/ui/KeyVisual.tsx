// Neo key visual: ≥5 blocks of varying width/height and accent colour, flush to the left or right edge,
// at most 1/3 of the viewport high. Each block is one tertiary colour fading to its own tint; neighbours
// never share size, colour or gradient direction. `progress` turns the blocks into a loading bar
// (Neo's "fill container"), filling one block after another.
import type { CSSProperties } from "react";

export type Accent = "green" | "lilac" | "citrus" | "red" | "blue" | "rose" | "peach";
type Dir = "h" | "v" | "d" | "ri" | "ro" | "solid";
interface Block { w: number; h: number; c: Accent | "white" | "black"; dir: Dir; }
interface Row { align: "start" | "end"; blocks: Block[] }

// Units: width and height in u (u = --kv-u, default 1vw; widths in 5u steps). Modelled on engine.hpi.de.
const PRESETS: Record<string, Row[]> = {
  hero: [
    { align: "end", blocks: [{ w: 5, h: 3, c: "blue", dir: "solid" }, { w: 10, h: 2, c: "rose", dir: "h" }, { w: 15, h: 1, c: "green", dir: "v" }] },
    { align: "start", blocks: [{ w: 10, h: 3, c: "peach", dir: "v" }, { w: 10, h: 2, c: "red", dir: "solid" }] },
    { align: "start", blocks: [{ w: 20, h: 2, c: "citrus", dir: "h" }, { w: 15, h: 0.5, c: "lilac", dir: "solid" }] },
  ],
  tall: [
    { align: "end", blocks: [{ w: 15, h: 6, c: "peach", dir: "v" }, { w: 20, h: 4, c: "blue", dir: "v" }, { w: 5, h: 2, c: "citrus", dir: "solid" }, { w: 35, h: 2, c: "red", dir: "h" }] },
    { align: "start", blocks: [{ w: 7, h: 4, c: "lilac", dir: "solid" }, { w: 15, h: 2, c: "green", dir: "h" }, { w: 4, h: 1, c: "white", dir: "solid" }, { w: 16, h: 1, c: "peach", dir: "solid" }] },
  ],
  footer: [
    { align: "end", blocks: [{ w: 10, h: 2, c: "lilac", dir: "h" }, { w: 5, h: 1, c: "red", dir: "solid" }, { w: 20, h: 0.5, c: "green", dir: "solid" }] },
    { align: "start", blocks: [{ w: 5, h: 2, c: "citrus", dir: "solid" }, { w: 15, h: 1, c: "blue", dir: "h" }, { w: 10, h: 2, c: "peach", dir: "v" }] },
  ],
  small: [
    { align: "end", blocks: [{ w: 4, h: 2, c: "red", dir: "solid" }, { w: 8, h: 1, c: "peach", dir: "h" }, { w: 12, h: 0.5, c: "lilac", dir: "solid" }] },
    { align: "start", blocks: [{ w: 8, h: 2, c: "green", dir: "h" }, { w: 4, h: 1, c: "blue", dir: "solid" }] },
  ],
};

const color = (c: Block["c"]) => (c === "white" ? "var(--white)" : c === "black" ? "var(--gray-100)" : `var(--${c})`);
const tint = (c: Block["c"]) => (c === "white" || c === "black" ? color(c) : `var(--${c}-tint-80)`);

function fill(b: Block): string {
  const a = color(b.c), z = tint(b.c);
  switch (b.dir) {
    case "h": return `linear-gradient(90deg, ${a}, ${z})`;
    case "v": return `linear-gradient(180deg, ${a}, ${z})`;
    case "d": return `linear-gradient(135deg, ${a}, ${z})`;
    case "ri": return `radial-gradient(closest-side, ${z}, ${a})`;
    case "ro": return `radial-gradient(closest-side, ${a}, ${z})`;
    default: return a;
  }
}

export interface KeyVisualProps {
  preset?: keyof typeof PRESETS;
  side?: "left" | "right";
  unit?: string; // CSS length per unit
  progress?: number | null; // 0..1 → fills blocks in order
  className?: string;
  style?: CSSProperties;
  animate?: boolean; // blocks grow in on mount
}

export function KeyVisual({ preset = "hero", side = "left", unit = "1vw", progress = null, className = "", style, animate = true }: KeyVisualProps) {
  const rows = PRESETS[preset];
  const all = rows.flatMap((r) => r.blocks);
  const total = all.reduce((s, b) => s + b.w, 0);
  let before = 0;
  return (
    <div
      className={`kv kv-${side} ${animate ? "kv-animate" : ""} ${className}`}
      style={{ ["--kv-u" as string]: unit, ...style }}
      aria-hidden="true"
    >
      {rows.map((row, ri) => (
        <div key={ri} className="kv-row" style={{ alignItems: row.align === "end" ? "flex-end" : "flex-start" }}>
          {row.blocks.map((b, bi) => {
            const start = before / total;
            before += b.w;
            const share = b.w / total;
            const f = progress == null ? 1 : Math.max(0, Math.min(1, (progress - start) / share));
            return (
              <div
                key={bi}
                className="kv-block"
                style={{
                  width: `calc(${b.w} * var(--kv-u))`,
                  height: `calc(${b.h} * var(--kv-u))`,
                  ["--kv-delay" as string]: `${(ri * 3 + bi) * 60}ms`,
                }}
              >
                <div className="kv-fill" style={{ background: fill(b), transform: `scaleX(${f})` }} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
