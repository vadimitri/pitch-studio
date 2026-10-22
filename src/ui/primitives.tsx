import type { ButtonHTMLAttributes, ReactNode } from "react";
import logoSvg from "../assets/engine-logo.svg?raw";

/** HPI Engine logo (official artwork from engine.hpi.de), only in black or white via currentColor. */
export function EngineLogo({ height = 32, className = "" }: { height?: number; className?: string }) {
  return (
    <span
      className={`engine-logo ${className}`}
      style={{ height, width: (height * 496) / 134 }}
      role="img"
      aria-label="HPI Engine"
      dangerouslySetInnerHTML={{ __html: logoSvg }}
    />
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "record" | "nav";
export function Button({
  variant = "primary", size = "m", icon, iconRight, children, className = "", ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "s" | "m" | "l"; icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon}
      {children != null && <span>{children}</span>}
      {iconRight}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", size = "m", children, iconRight, className = "" }: {
  href: string; variant?: BtnVariant; size?: "s" | "m" | "l"; children: ReactNode; iconRight?: ReactNode; className?: string;
}) {
  return (
    <a href={href} className={`btn btn-${variant} btn-${size} ${className}`}>
      <span>{children}</span>
      {iconRight}
    </a>
  );
}

/** Neo section tag: "● Label". */
export function Tag({ children, dot = true, tone = "default", className = "" }: { children: ReactNode; dot?: boolean; tone?: "default" | "red" | "inverse" | "outline"; className?: string }) {
  return (
    <span className={`tag tag-${tone} ${className}`}>
      {dot && <i className="tag-dot" />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, size = "m" }: {
  value: T; options: { value: T; label: ReactNode; hint?: string }[]; onChange: (v: T) => void; label?: string; size?: "s" | "m";
}) {
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={`seg-opt ${o.value === value ? "on" : ""}`}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="toggle-text">
        <span className="label-m">{label}</span>
        {hint && <span className="paragraph-xs fg-2">{hint}</span>}
      </span>
    </label>
  );
}

/** Circular progress (0..1). */
export function Ring({ value, size = 64, stroke = 3, color = "currentColor", track = "var(--stroke)", children, className = "" }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; className?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <span className={`ring ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      {children != null && <span className="ring-inner">{children}</span>}
    </span>
  );
}

/** Horizontal fill bar in the key-visual style. */
export function Bar({ value, color = "var(--fg)", height = 4 }: { value: number; color?: string; height?: number }) {
  return (
    <span className="bar" style={{ height }}>
      <span className="bar-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})`, background: color }} />
    </span>
  );
}
