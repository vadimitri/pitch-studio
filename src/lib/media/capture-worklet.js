// Audio thread: 10 ms level frames (dBFS), pitch (YIN, every 20 ms) and 16 kHz mono PCM for speech
// recognition. Plain JS on purpose: AudioWorklet modules are loaded by URL, not bundled.
const OUT_SR = 16000;
const MIN_F0 = 70, MAX_F0 = 400;

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = Math.round(sampleRate / 100);
    this.acc = 0; this.cnt = 0;
    this.db = []; this.f0 = [];
    // windowed-sinc low-pass at 7 kHz before resampling to 16 kHz
    const taps = 33, fc = Math.min(7000, OUT_SR * 0.45) / sampleRate;
    this.h = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - (taps - 1) / 2;
      const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
      this.h[i] = sinc * w; sum += this.h[i];
    }
    for (let i = 0; i < taps; i++) this.h[i] /= sum;
    this.hist = new Float32Array(taps);
    this.hpos = 0;
    this.step = sampleRate / OUT_SR; // input samples per output sample
    this.phase = 0;
    this.prevY = 0;
    this.out = new Float32Array(OUT_SR / 4); // post every 250 ms
    this.outN = 0;
    this.recording = false;
    // pitch ring at 16 kHz, 40 ms window
    this.ring = new Float32Array(640);
    this.ringN = 0;
    this.sinceF0 = 0;
    this.port.onmessage = ({ data }) => {
      if (data.cmd === "record") {
        if (!data.on && this.outN) this.flushPcm();
        this.recording = data.on;
        if (!data.on) this.port.postMessage({ type: "stopped" });
      }
    };
  }

  flushPcm() {
    const chunk = this.out.slice(0, this.outN);
    this.port.postMessage({ type: "pcm", data: chunk }, [chunk.buffer]);
    this.outN = 0;
  }

  pitch() {
    const L = this.ring.length, buf = this.lin ?? (this.lin = new Float32Array(L)), sr = OUT_SR;
    for (let i = 0; i < L; i++) buf[i] = this.ring[(this.ringN + i) % L]; // oldest first
    const minLag = Math.floor(sr / MAX_F0), maxLag = Math.floor(sr / MIN_F0);
    const n = buf.length - maxLag;
    let running = 0, best = 0, minD = 1, minTau = 0;
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    if (e / buf.length < 1e-6) return 0;
    const d = new Float32Array(maxLag + 2);
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < n; i += 2) { const x = buf[i] - buf[i + tau]; s += x * x; }
      running += s;
      d[tau] = running ? (s * tau) / running : 1;
      if (tau >= minLag && d[tau] < minD) { minD = d[tau]; minTau = tau; }
      if (tau >= minLag && d[tau] < 0.15) {
        while (tau + 1 <= maxLag) {
          let s2 = 0;
          for (let i = 0; i < n; i += 2) { const x = buf[i] - buf[i + tau + 1]; s2 += x * x; }
          running += s2;
          const dn = (s2 * (tau + 1)) / running;
          if (dn >= d[tau]) break;
          d[++tau] = dn;
        }
        best = tau;
        break;
      }
    }
    if (!best && minD < 0.3) best = minTau;
    return best ? sr / best : 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const h = this.h, taps = h.length;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      // level
      this.acc += x * x;
      if (++this.cnt === this.frame) {
        this.db.push(10 * Math.log10(this.acc / this.frame + 1e-12));
        this.acc = 0; this.cnt = 0;
      }
      // low-pass
      this.hist[this.hpos] = x;
      this.hpos = (this.hpos + 1) % taps;
      let y = 0;
      for (let k = 0, j = this.hpos; k < taps; k++, j = (j + 1) % taps) y += h[k] * this.hist[j];
      // fractional resample: next output sits at `phase` between the previous and this filtered sample
      while (this.phase <= 1) {
        const s = this.prevY + (y - this.prevY) * this.phase;
        this.phase += this.step;
        this.ring[this.ringN] = s;
        this.ringN = (this.ringN + 1) % this.ring.length;
        if (++this.sinceF0 >= 320) { this.sinceF0 = 0; this.f0.push(this.pitch()); }
        if (this.recording) {
          this.out[this.outN++] = s;
          if (this.outN === this.out.length) this.flushPcm();
        }
      }
      this.phase -= 1;
      this.prevY = y;
    }
    if (this.db.length >= 5) {
      this.port.postMessage({ type: "frames", db: this.db, f0: this.f0 });
      this.db = []; this.f0 = [];
    }
    return true;
  }
}
registerProcessor("capture", Capture);
