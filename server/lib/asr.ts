// Speech-to-text with word timestamps. Engines:
//   whisper  local whisper.cpp (`whisper-cli`), filler prompt so "äh/ähm" survive (default when available)
//   openai   any OpenAI-compatible /v1/audio/transcriptions server (Parakeet/CrisperWhisper box, HPI GPU)
//   none     skip; metrics then come from camera + audio only
import { existsSync } from "node:fs";
import { homedir, cpus } from "node:os";
import { join } from "node:path";

export type Word = { w: string; s: number; e: number };
export type Transcript = { engine: string; lang: string; words: Word[]; text: string; ms: number };

// Whisper drops disfluencies unless the prompt contains them (tested 2026-10-19: 0 → ~all of 42 German fillers).
const PROMPT: Record<string, string> = {
  de: "Ähm, also, äh, ich würde sagen, ähm, dass wir, äh, das so machen.",
  en: "Um, so, uh, I would say, um, that we, uh, do it like this.",
};

const WHISPER_BIN = Bun.which("whisper-cli");
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? join(homedir(), "models", "ggml-large-v3.bin");
export const ENGINE = process.env.ASR ?? (process.env.ASR_URL ? "openai" : WHISPER_BIN && existsSync(WHISPER_MODEL) ? "whisper" : "none");

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd[0]} exited ${code}: ${err.slice(-500)}`);
  return { out, err };
}

async function detectLang(wav: string) {
  const { err, out } = await run([WHISPER_BIN!, "-m", WHISPER_MODEL, "-f", wav, "-l", "auto", "-dl", "-np"]).catch(() => ({ err: "", out: "" }));
  const m = /auto-detected language: (\w+)/.exec(err + out);
  return m && PROMPT[m[1]] ? m[1] : "de";
}

async function whisper(wav: string, lang: string): Promise<Omit<Transcript, "ms">> {
  if (lang === "auto") lang = await detectLang(wav);
  const outBase = wav.replace(/\.wav$/, ".whisper");
  const threads = String(Math.max(2, Math.min(8, cpus().length - 1)));
  // -ml 1 -sow: one segment per word → word-level timestamps
  await run([WHISPER_BIN!, "-m", WHISPER_MODEL, "-f", wav, "-l", lang, "-t", threads, "-ml", "1", "-sow", "-oj", "-of", outBase, "--prompt", PROMPT[lang], "-np"]);
  const json = await Bun.file(`${outBase}.json`).json();
  const words: Word[] = json.transcription
    .map((seg: any) => ({ w: seg.text.trim(), s: seg.offsets.from / 1000, e: seg.offsets.to / 1000 }))
    .filter((x: Word) => x.w && /[\p{L}\p{N}]/u.test(x.w));
  return { engine: `whisper.cpp ${WHISPER_MODEL.split("/").pop()}`, lang, words, text: words.map((x) => x.w).join(" ") };
}

async function openai(wav: string, lang: string): Promise<Omit<Transcript, "ms">> {
  const form = new FormData();
  form.append("file", Bun.file(wav), "audio.wav");
  form.append("model", process.env.ASR_MODEL ?? "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (lang !== "auto") form.append("language", lang);
  if (PROMPT[lang]) form.append("prompt", PROMPT[lang]);
  const res = await fetch(process.env.ASR_URL!, {
    method: "POST",
    body: form,
    headers: process.env.ASR_KEY ? { Authorization: `Bearer ${process.env.ASR_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`ASR ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const words: Word[] = (json.words ?? []).map((x: any) => ({ w: String(x.word).trim(), s: x.start, e: x.end }));
  return { engine: `remote ${process.env.ASR_MODEL ?? ""}`.trim(), lang: json.language ?? lang, words, text: json.text ?? "" };
}

export async function transcribe(wav: string, lang: string): Promise<Transcript | null> {
  if (ENGINE === "none") return null;
  const t0 = performance.now();
  const r = ENGINE === "openai" ? await openai(wav, lang) : await whisper(wav, lang);
  return { ...r, ms: Math.round(performance.now() - t0) };
}
