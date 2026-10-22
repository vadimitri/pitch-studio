// Coach note after a take: one strength, one focus for the next take, one audience question.
// With ANTHROPIC_API_KEY (or an `ant auth login` profile) and COACH=claude it asks Claude; otherwise rule-based.
// Sending the transcript to the API is an external transfer: off unless explicitly enabled.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { pickFocus, pickStrength } from "../public/shared/metrics.js";
import { QUESTIONS } from "../public/shared/format.js";
import type { Word } from "./asr.ts";

export const COACH = process.env.COACH === "claude" ? "claude" : "rules";

export type Coach = { strength: string; focus: string; question: string; source: string };

const Schema = z.object({
  strength: z.string().describe("Eine konkrete Stärke, mit Zeitmarke oder kurzem Zitat."),
  focus: z.string().describe("Genau ein Fokus für den nächsten Take: wo (Zeitmarke) und was stattdessen."),
  question: z.string().describe("Eine kritische, faire Rückfrage aus dem Publikum zum Inhalt."),
});

const SYSTEM = `Du bist Präsentationscoach in einer Übungskabine an einer Hochschule. Nutzer:innen sind meist Informatik-Studierende, oft introvertiert, die gerade einen Vortrag oder Pitch geübt haben.
Regeln:
- Beschreibe Verhalten und Inhalt, nie Gefühle, Persönlichkeit oder Selbstbewusstsein (keine Emotionserkennung).
- Keine Noten, keine Scores, keine Liste. Genau eine Stärke, ein Fokus, eine Frage. Jeweils höchstens 2 Sätze.
- Der Fokus ist konkret umsetzbar: wo im Vortrag (mm:ss) und was stattdessen. Hat die Person vorher einen Fokus gewählt, bleib bei diesem.
- Die Messwerte sind Schätzungen aus Kamera und Mikrofon; formuliere vorsichtig, wenn du dich darauf stützt.
- Antworte in der Sprache des Vortrags (Deutsch oder Englisch).`;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Transcript as lines of ~8 s with timestamps, so Claude can point at places.
function timedTranscript(words: Word[]) {
  const lines: string[] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length && w.s - cur[0].s > 8) { lines.push(`[${mmss(cur[0].s)}] ${cur.map((x) => x.w).join(" ")}`); cur = []; }
    cur.push(w);
  }
  if (cur.length) lines.push(`[${mmss(cur[0].s)}] ${cur.map((x) => x.w).join(" ")}`);
  return lines.join("\n");
}

function rules(metrics: any, prev: any, chosen: string | null): Coach {
  return {
    strength: pickStrength(metrics),
    focus: pickFocus(metrics, prev, chosen).tip,
    question: QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)],
    source: "rules",
  };
}

let client: Anthropic | null = null;

export async function coach(opts: { words: Word[] | null; metrics: any; prev: any; chosen: string | null; targetSec: number }): Promise<Coach> {
  const fallback = rules(opts.metrics, opts.prev, opts.chosen);
  if (COACH !== "claude" || !opts.words?.length) return fallback;
  client ??= new Anthropic();
  const { lookTrack, ...m } = opts.metrics;
  try {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Zielzeit: ${opts.targetSec} s. Gewählter Fokus: ${opts.chosen ?? "keiner"}.\n\nMesswerte (JSON):\n${JSON.stringify(m)}\n\nTranskript:\n${timedTranscript(opts.words)}`,
      }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return fallback;
    return { ...res.parsed_output, source: "claude" };
  } catch (err) {
    console.error("coach:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    return fallback;
  }
}
