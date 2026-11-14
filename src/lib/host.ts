// Host mode, pure parts: cue cards from pasted text and time spent per card.
import type { CardMark, CueCard } from "./types";

const HEAD = /^#{1,6}\s+(.*)$/;
const RULE = /^\s*-{3,}\s*$/;

/** "Opening (1:30)" → title "Opening", budget 90. Also "[1:30]", "(90s)", "(2 min)". */
export function splitBudget(head: string): { title: string; budget?: number } {
  const mmss = head.match(/\s*[([]\s*(\d{1,2}):(\d{2})\s*[)\]]\s*$/);
  if (mmss) return { title: head.slice(0, mmss.index).trim(), budget: Number(mmss[1]) * 60 + Number(mmss[2]) };
  const unit = head.match(/\s*[([]\s*(\d+(?:[.,]\d+)?)\s*(s|sec|min|m)\s*[)\]]\s*$/i);
  if (unit) {
    const n = Number(unit[1].replace(",", "."));
    return { title: head.slice(0, unit.index).trim(), budget: Math.round(/^m/i.test(unit[2]) ? n * 60 : n) };
  }
  return { title: head.trim() };
}

/** A heading (#…) or a line of --- starts a new card; without either, every paragraph is a card
 *  whose first line is the title. Empty cards are dropped. */
export function parseCards(text: string): CueCard[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: { head: string | null; body: string[] }[] = [];
  if (lines.some((l) => HEAD.test(l) || RULE.test(l))) {
    let cur: { head: string | null; body: string[] } = { head: null, body: [] };
    for (const l of lines) {
      const h = l.match(HEAD);
      if (h || RULE.test(l)) {
        blocks.push(cur);
        cur = { head: h ? h[1] : null, body: [] };
      } else cur.body.push(l);
    }
    blocks.push(cur);
  } else {
    for (const para of text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const [first, ...rest] = para.split("\n");
      blocks.push({ head: first ?? "", body: rest });
    }
  }
  const cards: CueCard[] = [];
  for (const b of blocks) {
    const body = b.body.join("\n").trim();
    const { title, budget } = b.head == null ? { title: "", budget: undefined } : splitBudget(b.head);
    if (!title && !body) continue;
    cards.push(budget == null ? { title, body } : { title, body, budget });
  }
  return cards;
}

/** What a card is called in lists: its title, else its first line without markup. */
export const cardLabel = (c: CueCard): string =>
  c.title || (c.body.split("\n").find((l) => l.trim()) ?? "").replace(/\*\*/g, "").trim();

/** Planned length when every card has a budget, else null. */
export function cardsTarget(cards: CueCard[]): number | null {
  if (!cards.length || cards.some((c) => c.budget == null)) return null;
  return cards.reduce((s, c) => s + (c.budget ?? 0), 0);
}

/** Seconds each card was on screen (going back counts again) and when it first appeared (null = never). */
export function cardTimes(marks: CardMark[], duration: number, n: number): { used: number[]; first: (number | null)[] } {
  const used = new Array<number>(n).fill(0);
  const first = new Array<number | null>(n).fill(null);
  const ms = [...marks].sort((a, b) => a.t - b.t);
  ms.forEach((m, k) => {
    if (m.i < 0 || m.i >= n || m.t >= duration) return;
    const end = Math.min(duration, k + 1 < ms.length ? ms[k + 1].t : duration);
    used[m.i] += Math.max(0, end - m.t);
    if (first[m.i] == null) first[m.i] = m.t;
  });
  return { used, first };
}
