// Filler lexicon and syllable counting (German + English).
// "filled" = filled pauses (äh, um): what the counter reports.
// "soft" = discourse markers that are legit words; only reported when overused.
import type { SpeechLang } from "../types";

// Per language: "um" (around) and "er" (he) are ordinary German words, "eh" (anyway) too.
const FILLED_COMMON = ["äh", "ähm", "ähh", "ähhm", "ähmm", "äm", "öhm", "öh", "ehm", "hm", "hmm", "mh", "mm", "uh", "uhh", "uhm", "umm"];
const FILLED: Record<SpeechLang, Set<string>> = {
  de: new Set(FILLED_COMMON),
  en: new Set([...FILLED_COMMON, "um", "er", "erm"]),
};
const FILLED_ANY = new Set([...FILLED.de, ...FILLED.en]);

// Words a recogniser tends to produce when it hears a filler (Parakeet: "ihr", "im", "er").
export const FILLER_LIKE = new Set([...FILLED_ANY, "ihr", "im", "e", "ä", "äm", "öh", "er", "um", "eh", "em", "ah"]);

const SOFT: Record<SpeechLang, string[]> = {
  de: ["also", "quasi", "sozusagen", "halt", "eigentlich", "irgendwie", "genau", "praktisch", "eben", "gewissermaßen", "ne"],
  en: ["like", "basically", "actually", "literally", "so", "right", "okay", "kinda"],
};

export const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
/** Filled pause ("äh", "um") in the given language; without a language any known filler counts. */
export const isFilled = (word: string, lang?: SpeechLang) => (lang ? FILLED[lang] : FILLED_ANY).has(norm(word));
export const softList = (lang: SpeechLang) => SOFT[lang] ?? [...SOFT.de, ...SOFT.en];

// Vowel groups, diphthongs counted once. Good to roughly ±10 % on running text.
export function syllables(word: string, lang: SpeechLang = "de"): number {
  const w = norm(word).replace(/(ei|ie|au|eu|äu|ai|ou|ea|ee|oo)/g, "a");
  const groups = w.match(/[aeiouyäöü]+/g);
  if (!groups) return /\d/.test(w) ? Math.max(1, w.length) : 0;
  let n = groups.length;
  if (lang === "en" && n > 1 && /[^aeiouy]e$/.test(w)) n -= 1; // silent final e
  return Math.max(1, n);
}

/** Normalised filler label: "uh" (äh), "um" (ähm), "hm". */
export function fillerKind(word: string): "uh" | "um" | "hm" {
  const w = norm(word);
  if (/^(h?m+|mh+|mhm)$/.test(w)) return "hm";
  if (/m$/.test(w)) return "um";
  return "uh";
}
