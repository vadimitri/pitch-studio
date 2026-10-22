// "Why" notes for the demo: one sentence and one source at each step, so a visitor sees the research behind what
// they just did. Toggled in the header, hidden in the booth (CSS).
import { useT } from "../i18n";
import { persisted, useStore } from "../lib/store";
import { IconInfo } from "./icons";

export const notesPref = persisted<{ on: boolean }>("ps.notes", { on: true });

type NoteKey = "setup" | "calibrate" | "recording" | "predict" | "replay" | "review";

export function DemoNote({ k, className = "" }: { k: NoteKey; className?: string }) {
  const t = useT();
  const { on } = useStore(notesPref);
  if (!on) return null;
  const n = t.notes[k];
  return (
    <aside className={`demo-note ${className}`}>
      <span className="demo-note-label mono-xs"><IconInfo width={14} height={14} /> {t.notes.label}</span>
      <p className="paragraph-xs">{n.d} <span className="demo-note-src mono-xs">{n.s}</span></p>
    </aside>
  );
}

export function NotesToggle() {
  const t = useT();
  const { on } = useStore(notesPref);
  return (
    <button className={`notes-toggle mono-xs ${on ? "on" : ""}`} aria-pressed={on} onClick={() => notesPref.patch({ on: !on })}>
      <IconInfo width={14} height={14} /> {t.notes.toggle}
    </button>
  );
}
