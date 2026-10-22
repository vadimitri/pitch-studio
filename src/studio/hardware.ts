// The booth's red button + LED ring (firmware/code.py). Without pairing the button is a USB keyboard sending
// F13. Paired via Web Serial (Chrome), button presses arrive as DOWN/UP and the ring shows the phase:
// idle | calib | count <n> | rec <0..1> | cue | proc | replay | share | ok | off. Pings keep the device in
// serial mode; when they stop it falls back to F13.
import { createStore } from "../lib/store";

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}
type SerialApi = { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> };
const api = (): SerialApi | null => ((navigator as unknown as { serial?: SerialApi }).serial ?? null);

export const buttonState = createStore({ supported: false, connected: false });
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let last = "";
let ping: ReturnType<typeof setInterval> | undefined;

/** Button presses become F13 key events, so the studio handles keyboard, HID and serial the same way. */
const emit = (type: "keydown" | "keyup") => window.dispatchEvent(new KeyboardEvent(type, { key: "F13", code: "F13", bubbles: true }));

async function open(port: SerialPortLike): Promise<boolean> {
  try {
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    buttonState.patch({ connected: true });
    send("HELLO");
    clearInterval(ping);
    ping = setInterval(() => send("PING"), 2000);
    void read(port);
    return true;
  } catch (e) {
    console.warn("serial", e);
    return false;
  }
}

async function read(port: SerialPortLike) {
  const dec = new TextDecoder();
  let buf = "";
  const reader = port.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === "DOWN") emit("keydown");
        else if (line === "UP") emit("keyup");
      }
    }
  } catch (e) {
    console.warn("serial read", e);
  }
  writer = null;
  clearInterval(ping);
  buttonState.patch({ connected: false });
}

function send(line: string) {
  writer?.write(new TextEncoder().encode(line + "\n")).catch(() => buttonState.patch({ connected: false }));
}

export const hardware = {
  /** Reconnect a previously paired button silently. */
  async auto() {
    const s = api();
    buttonState.patch({ supported: !!s });
    if (!s) return false;
    const [port] = await s.getPorts();
    return port ? open(port) : false;
  },
  /** First pairing; needs a user gesture. */
  async pair() {
    const s = api();
    if (!s) return false;
    try { return await open(await s.requestPort()); } catch { return false; }
  },
  led(mode: string, arg: string | number = "") {
    const line = `MODE ${mode} ${arg}`.trim();
    if (line === last) return;
    last = line;
    send(line);
  },
};
