// Pitch Studio server: static booth/tablet/share pages, take storage, analysis pipeline,
// timestamped comments, WebSocket relay between booth and tablet. Zero config: `bun server.ts`.
import { Database } from "bun:sqlite";
import { mkdir, readdir, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join, normalize } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { computeMetrics } from "./public/shared/metrics.js";
import { ENGINE, transcribe, type Word } from "./lib/asr.ts";
import { COACH, coach } from "./lib/coach.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC = join(import.meta.dir, "public");
const DATA = process.env.DATA_DIR ?? join(import.meta.dir, "data");
const TAKES = join(DATA, "takes");
const KEEP_DAYS = Number(process.env.KEEP_DAYS ?? 30); // claimed takes
const UNCLAIMED_MIN = Number(process.env.UNCLAIMED_MIN ?? 120); // safety net if the booth never ends the session
await mkdir(TAKES, { recursive: true });

function lanIp() {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return "localhost";
}
// Phones open the QR over mobile data: production needs PUBLIC_URL with HTTPS.
const BASE = (process.env.PUBLIC_URL ?? `http://${lanIp()}:${PORT}`).replace(/\/$/, "");

const db = new Database(join(DATA, "studio.sqlite"));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS takes (id TEXT PRIMARY KEY, session TEXT, owner TEXT, created INTEGER, claimed INTEGER DEFAULT 0,
  expires INTEGER, status TEXT, meta TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, take TEXT, t REAL, kind TEXT, name TEXT, text TEXT, created INTEGER);`);

type TakeRow = { id: string; session: string; owner: string; created: number; claimed: number; expires: number | null; status: string; meta: string; result: string | null };
const getTake = (id: string) => db.query<TakeRow, [string]>("SELECT * FROM takes WHERE id = ?").get(id);
const setResult = (id: string, status: string, result: object) =>
  db.run("UPDATE takes SET status = ?, result = ? WHERE id = ?", [status, JSON.stringify(result), id]);

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const json = (x: unknown, status = 200) => Response.json(x, { status });
const isOwner = (row: TakeRow, req: Request, url: URL) => (req.headers.get("x-owner") ?? url.searchParams.get("k")) === row.owner;

let server: Server;
const broadcast = (msg: object) => server?.publish("studio", JSON.stringify(msg));

// ---------- pipeline ----------

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`${cmd[0]}: ${err.slice(-400)}`);
}
const ffmpeg = (args: string[]) => sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args]);

async function toMp4(raw: string, out: string) {
  if (raw.endsWith(".mp4")) return ffmpeg(["-i", raw, "-c", "copy", "-movflags", "+faststart", out]);
  const enc = (v: string[]) => ffmpeg(["-i", raw, ...v, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]);
  await enc(["-c:v", "h264_videotoolbox", "-b:v", "5M"]).catch(() => enc(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]));
}

function analyse(meta: any, words: Word[] | null, lang: string) {
  const fixed = words?.filter((w) => !(meta.corrections ?? []).some((t: number) => Math.abs(t - w.s) < 0.05)) ?? null;
  return computeMetrics({ timeline: meta.timeline, durationSec: meta.durationSec, targetSec: meta.targetSec, lang, calib: meta.calib, words: fixed });
}

async function processTake(id: string) {
  const row = getTake(id);
  if (!row) return;
  const meta = JSON.parse(row.meta);
  const dir = join(TAKES, id);
  const raw = join(dir, (await readdir(dir)).find((f) => f.startsWith("raw."))!);
  const wav = join(dir, "audio.wav");
  const t0 = performance.now();

  await ffmpeg(["-i", raw, "-vn", "-ac", "1", "-ar", "16000", wav]);
  const transcript = await transcribe(wav, meta.lang).catch((e) => (console.error("asr:", e.message), null));
  const lang = transcript?.lang ?? (meta.lang === "auto" ? "de" : meta.lang);
  const metrics = analyse(meta, transcript?.words ?? null, lang);
  const prevRow = meta.prevId ? getTake(meta.prevId) : null;
  const prev = prevRow?.result ? JSON.parse(prevRow.result).metrics : null;
  const note = await coach({ words: transcript?.words ?? null, metrics, prev, chosen: meta.focus ?? null, targetSec: meta.targetSec });
  const result: any = { transcript, metrics, coach: note, video: null, ms: 0 };
  setResult(id, "analysed", result);
  broadcast({ type: "take", id, status: "analysed" });

  await toMp4(raw, join(dir, "video.mp4"));
  const at = metrics.best ? metrics.best.s + 2 : Math.min(2, meta.durationSec / 2);
  await ffmpeg(["-ss", String(at), "-i", join(dir, "video.mp4"), "-frames:v", "1", "-vf", "scale=720:-2", join(dir, "poster.jpg")]).catch(() => {});
  await rm(raw);
  result.video = "video.mp4";
  result.ms = Math.round(performance.now() - t0);
  setResult(id, "done", result);
  broadcast({ type: "take", id, status: "done" });
  console.log(`take ${id}: ${meta.durationSec.toFixed(0)} s in ${(result.ms / 1000).toFixed(1)} s (asr ${transcript?.ms ?? "-"} ms, coach ${note.source})`);
}

const queue: string[] = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift()!;
    try { await processTake(id); } catch (e: any) {
      console.error(`take ${id} failed:`, e.message);
      db.run("UPDATE takes SET status = 'error' WHERE id = ?", [id]);
      broadcast({ type: "take", id, status: "error" });
    }
  }
  busy = false;
}

async function deleteTake(id: string) {
  db.run("DELETE FROM takes WHERE id = ?", [id]);
  db.run("DELETE FROM comments WHERE take = ?", [id]);
  await rm(join(TAKES, id), { recursive: true, force: true });
}

async function sweep() {
  const now = Date.now();
  const old = db.query<{ id: string }, [number, number]>(
    "SELECT id FROM takes WHERE (claimed = 0 AND created < ?) OR (claimed = 1 AND expires < ?)").all(now - UNCLAIMED_MIN * 60_000, now);
  for (const { id } of old) await deleteTake(id);
  if (old.length) console.log(`sweep: deleted ${old.length} take(s)`);
}
setInterval(sweep, 10 * 60_000);
sweep();

// ---------- HTTP ----------

async function serveFile(path: string, req: Request, type?: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  const size = file.size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  const headers: Record<string, string> = { "Accept-Ranges": "bytes", "Content-Type": type ?? file.type };
  if (!m) return new Response(file, { headers });
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}

// connect-src blocks any library phoning home; Hugging Face only serves the Parakeet weights (local mode).
const CSP = "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; " +
  "connect-src 'self' ws: wss: blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co";

async function staticFile(pathname: string, req: Request) {
  if (pathname.endsWith("/")) pathname += "index.html";
  const path = normalize(join(PUBLIC, pathname));
  if (!path.startsWith(PUBLIC)) return new Response("no", { status: 403 });
  const res = await serveFile(path, req);
  if (path.endsWith(".html")) res.headers.set("Content-Security-Policy", CSP);
  if (path.endsWith(".js") || path.endsWith(".mjs")) res.headers.set("Content-Type", "text/javascript; charset=utf-8");
  return res;
}

// Reviewers get video + transcript; measurements, coach note and self-rating stay with the owner.
function takeView(row: TakeRow, owner: boolean) {
  const meta = JSON.parse(row.meta);
  const result = row.result ? JSON.parse(row.result) : null;
  const pub = { durationSec: meta.durationSec, lang: meta.lang, question: meta.question ?? null };
  return {
    id: row.id, created: row.created, status: row.status, claimed: !!row.claimed, expires: row.expires, owner,
    meta: owner ? { ...pub, targetSec: meta.targetSec, focus: meta.focus, brief: meta.brief, timeline: meta.timeline, calib: meta.calib,
      prediction: meta.prediction ?? null, corrections: meta.corrections ?? [] } : pub,
    result: result && (owner ? result : { transcript: result.transcript, video: result.video }),
  };
}

async function api(req: Request, url: URL): Promise<Response> {
  const p = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (p[1] === "config") return json({ base: BASE, asr: ENGINE, coach: COACH, keepDays: KEEP_DAYS });

  if (p[1] === "sessions" && p[2] && method === "DELETE") {
    const ids = db.query<{ id: string }, [string]>("SELECT id FROM takes WHERE session = ? AND claimed = 0").all(p[2]);
    for (const { id } of ids) await deleteTake(id);
    return json({ deleted: ids.length });
  }

  if (p[1] !== "takes") return json({ error: "not found" }, 404);

  if (!p[2] && method === "POST") {
    const form = await req.formData();
    const video = form.get("video") as File | null;
    const meta = JSON.parse(String(form.get("meta") ?? "{}"));
    if (!video || !meta.timeline) return json({ error: "video and meta required" }, 400);
    const id = token(), owner = token();
    await mkdir(join(TAKES, id), { recursive: true });
    await Bun.write(join(TAKES, id, video.type.includes("mp4") ? "raw.mp4" : "raw.webm"), video);
    db.run("INSERT INTO takes (id, session, owner, created, status, meta) VALUES (?, ?, ?, ?, 'queued', ?)",
      [id, String(meta.sessionId ?? ""), owner, Date.now(), JSON.stringify(meta)]);
    queue.push(id);
    pump();
    return json({ id, owner, shareUrl: `${BASE}/v/${id}`, ownerUrl: `${BASE}/v/${id}#k=${owner}` });
  }

  const row = p[2] ? getTake(p[2]) : null;
  if (!row) return json({ error: "not found" }, 404);
  const owner = isOwner(row, req, url);
  const sub = p[3];

  if (!sub && method === "GET") return row.claimed || owner ? json(takeView(row, owner)) : json({ error: "not shared" }, 403);
  if (!sub && method === "DELETE") return owner ? (await deleteTake(row.id), json({ ok: true })) : json({ error: "owner only" }, 403);
  if ((sub === "video" || sub === "poster") && method === "GET") {
    if (!row.claimed && !owner) return new Response("not shared", { status: 403 });
    return sub === "poster" ? serveFile(join(TAKES, row.id, "poster.jpg"), req) : serveFile(join(TAKES, row.id, "video.mp4"), req, "video/mp4");
  }
  if (sub === "claim" && method === "POST" && owner) {
    const expires = Date.now() + KEEP_DAYS * 86_400_000;
    db.run("UPDATE takes SET claimed = 1, expires = ? WHERE id = ?", [expires, row.id]);
    broadcast({ type: "claimed", id: row.id });
    return json({ ok: true, expires });
  }
  if (sub === "meta" && method === "PATCH" && owner) {
    // owner-editable fields: question for reviewers, self-prediction, "that wasn't an äh" corrections
    const body = await req.json();
    const meta = JSON.parse(row.meta);
    for (const k of ["question", "prediction", "corrections"]) if (k in body) meta[k] = body[k];
    db.run("UPDATE takes SET meta = ? WHERE id = ?", [JSON.stringify(meta), row.id]);
    if ("corrections" in body && row.result) {
      const result = JSON.parse(row.result);
      result.metrics = analyse(meta, result.transcript?.words ?? null, result.transcript?.lang ?? "de");
      setResult(row.id, row.status, result);
    }
    return json(takeView(getTake(row.id)!, true));
  }
  if (sub === "comments") {
    if (method === "GET") {
      if (!owner) return json({ error: "owner only" }, 403); // reviewers don't anchor on each other
      return json(db.query("SELECT id, t, kind, name, text, created FROM comments WHERE take = ? ORDER BY t").all(row.id));
    }
    if (method === "POST") {
      if (!row.claimed) return json({ error: "not shared" }, 403);
      const b = await req.json();
      const kind = ["lands", "lost", "drags", "keep", "change", "try", "answer"].includes(b.kind) ? b.kind : "note";
      db.run("INSERT INTO comments (take, t, kind, name, text, created) VALUES (?, ?, ?, ?, ?, ?)",
        [row.id, Number(b.t) || 0, kind, String(b.name ?? "").slice(0, 40), String(b.text ?? "").slice(0, 1000), Date.now()]);
      return json({ ok: true });
    }
  }
  return json({ error: "not found" }, 404);
}

server = Bun.serve({
  port: PORT,
  maxRequestBodySize: 1024 ** 3,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
    if (url.pathname.startsWith("/api/")) return api(req, url).catch((e) => (console.error(e), json({ error: e.message }, 500)));
    const go = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
    if (url.pathname === "/") return go("/booth/");
    if (url.pathname === "/tablet" || url.pathname === "/booth") return go(`${url.pathname}/`);
    if (/^\/v\/[\w-]+$/.test(url.pathname)) return staticFile("/v/index.html", req);
    return staticFile(url.pathname, req);
  },
  websocket: {
    open(ws: ServerWebSocket) { ws.subscribe("studio"); },
    message(ws: ServerWebSocket, msg) { ws.publish("studio", typeof msg === "string" ? msg : msg.toString()); },
  },
});

console.log(`Pitch Studio  asr=${ENGINE} coach=${COACH}
  Booth (auf diesem Rechner, Kamera braucht localhost):  http://localhost:${PORT}/booth/
  Tablet / Handy im selben WLAN:                         ${BASE}/tablet/`);
