// Mic analysis on the main thread side: live level/pitch for the audience and timeline, and the 16 kHz PCM
// of the take for speech recognition (streamed while recording). All local.
import { createStore } from "../store";

export interface VoiceState {
  db: number; // current level dBFS
  floor: number; // tracked noise floor
  f0: number; // Hz, 0 = unvoiced
  speaking: boolean;
  energy: number; // 0..1 smoothed loudness above the floor, for visuals
}

export interface AudioEngine {
  voice: ReturnType<typeof createStore<VoiceState>>;
  ctx: AudioContext;
  startCapture(onChunk?: (pcm: Float32Array, startSample: number) => void): void;
  stopCapture(): Promise<Float32Array>;
  close(): void;
}

export async function createAudioEngine(stream: MediaStream): Promise<AudioEngine> {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture", { numberOfInputs: 1, numberOfOutputs: 0 });
  src.connect(node);

  const voice = createStore<VoiceState>({ db: -100, floor: -60, f0: 0, speaking: false, energy: 0 });
  let chunks: Float32Array[] = [];
  let samples = 0;
  let onChunk: ((pcm: Float32Array, start: number) => void) | undefined;
  let lastF0 = 0, lastF0At = 0;
  let stopped: (() => void) | null = null;

  node.port.onmessage = ({ data }) => {
    if (data.type === "stopped") { stopped?.(); stopped = null; return; }
    if (data.type === "pcm") {
      const pcm = data.data as Float32Array;
      const start = samples;
      chunks.push(pcm);
      samples += pcm.length;
      onChunk?.(pcm, start);
      return;
    }
    // frames: 10 ms dB values (+ ~20 ms pitch values)
    const v = voice.get();
    let { floor, energy } = v;
    let db = v.db;
    for (const x of data.db as number[]) {
      db = x;
      // noise floor: falls fast, rises slowly
      floor = x < floor ? x : floor + 0.01;
      floor = Math.min(floor, -35);
      const e = Math.max(0, Math.min(1, (x - floor - 6) / 30));
      energy = energy * 0.85 + e * 0.15;
    }
    const f0s = (data.f0 as number[]).filter((f) => f > 0);
    const now = performance.now();
    if (f0s.length) { lastF0 = f0s[f0s.length - 1]; lastF0At = now; }
    const speaking = db > floor + 10;
    voice.set({ db, floor, energy, speaking, f0: speaking && now - lastF0At < 120 ? lastF0 : 0 });
  };

  return {
    voice,
    ctx,
    startCapture(cb) {
      chunks = [];
      samples = 0;
      onChunk = cb;
      if (ctx.state !== "running") void ctx.resume();
      node.port.postMessage({ cmd: "record", on: true });
    },
    async stopCapture() {
      // the worklet flushes its last partial chunk, then acknowledges
      await new Promise<void>((resolve) => {
        stopped = resolve;
        node.port.postMessage({ cmd: "record", on: false });
        setTimeout(resolve, 500); // suspended context: do not hang
      });
      const out = new Float32Array(samples);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      onChunk = undefined;
      return out;
    },
    close() {
      node.port.onmessage = null;
      src.disconnect();
      void ctx.close();
    },
  };
}
