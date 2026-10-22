// Hallucination guards and filler prompts for Whisper (pure).
// Whisper writes "äh"/"um" only when the decoder context already contains them, so every chunk is
// decoded after a short filler-rich "previous text" (<|startofprev|> ... ), which 4.3.1 accepts via
// decoder_input_ids (prompt_ids is ignored there).
import type { SpeechLang, Word } from "../types";

export const FILLER_PROMPT: Record<SpeechLang, string> = {
  de: " Ähm, also, äh, ich hab, ähm, gedacht, äh, dass wir, hm, das so machen.",
  en: " Um, so, uh, I was, um, thinking, uh, that we, hmm, could do that.",
};

/** Chunks with less speech than this are not sent to Whisper (it invents text for silence). */
export const MIN_SPEECH_SEC = 0.3;
const MAX_TARGET_POSITIONS = 448;

/** Token budget for a chunk: fast speech is ~4 words/s ≈ 8 tokens/s incl. punctuation and timestamps. */
export function maxNewTokens(durSec: number, initLen: number): number {
  return Math.max(8, Math.min(MAX_TARGET_POSITIONS - initLen - 1, Math.ceil(durSec * 9) + 12));
}

const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Collapses decoder loops: an n-gram (n ≤ 8) repeated back to back ≥ 3 times (single words ≥ 4 times)
 * is kept once. Real speech rarely repeats that way; Whisper loops do, filler loops included.
 */
export function dropRepeats(words: Word[]): Word[] {
  const out = [...words];
  for (let n = 1; n <= 8; n++) {
    const need = n === 1 ? 4 : 3;
    for (let i = 0; i + n * need <= out.length; i++) {
      let k = 1;
      while (i + (k + 1) * n <= out.length && same(out, i, i + k * n, n)) k++;
      if (k >= need) out.splice(i + n, (k - 1) * n);
    }
  }
  return out;
}

function same(a: Word[], i: number, j: number, n: number) {
  for (let m = 0; m < n; m++) if (key(a[i + m].w) !== key(a[j + m].w)) return false;
  return true;
}

// Phrases Whisper produces on silence/noise (training data: subtitle credits, video outros).
const CREDITS = /untertitel (im auftrag|der|von)|amara\.org|subtitles by|transcribed by|copyright ©/i;
const OUTRO = /^(amen|danke|vielen dank( fürs zu(schauen|hören))?|tschüss|bis zum nächsten mal|thank you( for watching| so much)?|thanks for watching|bye|you)$/i;

/** True if a chunk's whole output is a known silence hallucination (only for chunks with little speech). */
export function isHallucination(text: string, speechSec: number): boolean {
  const t = text.trim().replace(/[.!?,…]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (speechSec < 4 && CREDITS.test(t)) return true;
  return speechSec < 1.5 && OUTRO.test(t);
}

/** Removes a verbatim echo of the filler prompt (≥ 6 consecutive prompt words), which Whisper emits on near-silence. */
export function dropPromptEcho(words: Word[], lang: SpeechLang): Word[] {
  const p = FILLER_PROMPT[lang].split(/\s+/).map(key).filter(Boolean);
  const out: Word[] = [];
  for (let i = 0; i < words.length; ) {
    let best = 0;
    for (let j = 0; j < p.length; j++) {
      let m = 0;
      while (i + m < words.length && j + m < p.length && key(words[i + m].w) === p[j + m]) m++;
      best = Math.max(best, m);
    }
    if (best >= 6) { i += best; continue; }
    out.push(words[i++]);
  }
  return out;
}

export function applyGuards(words: Word[], lang: SpeechLang): Word[] {
  return dropPromptEcho(dropRepeats(words), lang);
}
