import { useT } from "../i18n";
import type { Take } from "../lib/types";
import { LangToggle } from "../ui/Chrome";
import { NotesToggle } from "../ui/DemoNote";
import { IconClose } from "../ui/icons";
import { EngineLogo } from "../ui/primitives";
import type { Phase } from "./Studio";

export function StudioBar({ booth, takes, currentId, phase, onSelect, onExit }: {
  booth: boolean; takes: Take[]; currentId: string | null; phase: Phase;
  onSelect: (id: string) => void; onExit: () => void;
}) {
  const t = useT();
  return (
    <header className="studio-bar">
      <div className="brand">
        <EngineLogo height={booth ? 34 : 26} />
        <span className="brand-sep" />
        <span className="brand-name">Pitch Studio</span>
      </div>
      {takes.length > 0 && (
        <nav className="take-strip" aria-label="Takes">
          {takes.map((tk) => (
            <button key={tk.id} className={`take-chip ${tk.id === currentId && phase !== "setup" ? "on" : ""} ${tk.saved ? "saved" : ""}`} onClick={() => onSelect(tk.id)}>
              {t.replay.take(tk.n)}
            </button>
          ))}
        </nav>
      )}
      <div className="row gap-3">
        {!booth && <NotesToggle />}
        <LangToggle />
        {!booth && (
          <button className="btn btn-ghost btn-s" onClick={onExit} aria-label={t.studio.exit}>
            <IconClose width={16} height={16} /><span className="nav-hide-s">{t.studio.exit}</span>
          </button>
        )}
      </div>
    </header>
  );
}
