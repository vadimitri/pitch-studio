# Pitch Studio

A practice booth for talks, built for [HPI Engine](https://engine.hpi.de). Press the red button, 3-2-1, talk to a calm audience, then watch yourself back with an honest transcript, a few clear measures and one thing to try next. Everything runs in the browser; nothing is uploaded.

**Try it:** https://vadimitri.github.io/pitch-studio/ — Chrome or Safari on a laptop with camera and microphone. The demo asks for a password (ask Vadim). First visit downloads the speech model once (~0.6 GB, cached afterwards).

Evidence for each design decision: [RESEARCH.md](RESEARCH.md).

## What happens in the browser
| Part | How |
|---|---|
| Recording | MediaRecorder MP4 (H.264 + AAC), remuxed with [Mediabunny](https://mediabunny.dev) for an exact duration and fast start |
| Audio | AudioWorklet: level, pitch (YIN, filler fallback only), 16 kHz PCM |
| Transcript + word timestamps | Whisper large-v3 turbo (q4f16) via [transformers.js](https://github.com/huggingface/transformers.js) on WebGPU in a worker, transcribed in pause-cut chunks while you talk; Whisper small on WASM without WebGPU |
| Fillers | Whisper with a filler prompt + the [Uhm](https://huggingface.co/desert-ant-labs/uhm) detector (Powered by Desert Ant Labs) |
| Eye contact (estimate) | MediaPipe face landmarks → normalised face crop → ETH-XGaze ResNet-18 (ONNX, in a worker) → angle to the lens, per-person calibration |
| Gestures | MediaPipe gesture recogniser, hold to confirm |
| Storage | Session takes in memory; kept takes in IndexedDB of this browser |

## Develop
```sh
bun install
bun run dev          # http://localhost:5173  (vendors MediaPipe + ONNX Runtime into public/vendor first)
bun run test         # unit tests (metrics, gaze maths, ASR helpers)
bun run build        # typecheck + static build in dist/
```
Routes: `#/` landing · `#/studio` · `#/takes` · `#/review/<id>`. Debug: `#/studio?debug=1` (vision overlay), `?asr=wasm` (force the WASM recogniser).

## The booth (Mac mini + TV + red button)
```sh
bun run build && bun run preview -- --port 8080 --strictPort   # or any static server on localhost
open -na "Google Chrome" --args --kiosk --force-device-scale-factor=1.5 \
  --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream \
  "http://localhost:8080/#/studio?booth=1&cam=top"
```
- `cam=top|left|right`: where the camera sits relative to the TV (countdown, timer and audience gather there). Above the TV is clearly better for eye contact than beside it.
- `--force-device-scale-factor=1.5` makes a 1080p TV lay out like a 1280×720 screen, readable from 2 m.
- Button: `firmware/` (Pico 2, CircuitPython) is a USB keyboard sending F13; pair once via "Connect button (Web Serial)" for the LED ring. Press = start / stop / again, hold = discard / end session.
- Booth keys: `1–6` brief, `Esc` back. A session ends after 75 s without a face; unsaved takes are deleted.
- `server/` holds the v1 booth server (SQLite, QR sharing, wall tablet) as reference; it is not wired to v2 yet.

## Keys (laptop)
Setup: `Space` start · `1–6` brief · `T` eye-contact check. Recording: `Space` stop, hold to discard. Predict: `↑ → ↓` or `1 2 3`. Replay: `Space` play/pause · `Enter`/`R` again · `S` share · `C` compare · `D` delete (twice) · `←/→` 5 s · `Esc` new setup. With gestures on (toggle next to Start): open palm start/again · thumbs up share · victory compare · thumbs down delete; hold 0.6 s, a panel near the lens shows what it recognised and what will happen. Replay and review (your view) show what the model counted over the video: a box around the face with lens / screen / down / away; toggle "Detection". Phones get a "laptops only" page.

## Credits
Made by [vadimitri](https://github.com/vadimitri). Design: HPI Engine Neo design system; PP Neue Montreal is loaded from engine.hpi.de. Gaze model weights: [hysts/ptgaze](https://github.com/hysts/pytorch_mpiigaze_demo) (MIT), trained on ETH-XGaze (research use). Filler detection: Powered by [Desert Ant Labs](https://huggingface.co/desert-ant-labs/uhm). Not an official HPI service.
