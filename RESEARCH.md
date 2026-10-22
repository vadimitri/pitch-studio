# Research behind Pitch Studio

One finding per line, → what Pitch Studio does with it. Mostly checked at abstract level. As of October 2026.

## Does video feedback work?
- Video feedback improves speaking skills without raising anxiety. [Bourhis & Allen 1998](https://doi.org/10.1080/08824099809362121) → instant replay is the core
- Effect d ≈ 0.40, larger with a fixed observation focus. [Fukkink et al. 2011](https://doi.org/10.1007/s10648-010-9144-5) → one focus per take
- Video plus measures helps more than video alone; loudness was accurate but useless ("I can hear that myself"). [Fung et al. 2015](https://doi.org/10.1145/2750858.2804265) → only show what you can't notice yourself
- Automated + peer feedback improves talks, peer text alone does not. [Zhao et al. 2017](https://doi.org/10.1145/3090097) → measures and team notes
- Predict first, then watch "like a stranger": self-image becomes more accurate. [Harvey et al. 2000](https://www.psy.ox.ac.uk/publication/244155) → "How did it go?" before the replay, video unmirrored
- Most people underestimate themselves; 98 % look better than they feared. [Warnock-Parkes et al. 2017](https://doi.org/10.1016/j.cbpra.2016.03.007) → "How did it go?" first (the best-8-seconds intro was dropped after the first demo test: it confused more than it reassured)

## Audience and anxiety
- Rehearsing in front of an audience (the bigger the better) predicts better grades. [Smith & Frymier 2006](https://doi.org/10.1080/01463370500270538), [Menzel & Carrell 1994](https://doi.org/10.1080/03634529409378958) → audience in the studio
- Rehearsing alone flattens the voice with every repetition; a virtual audience reverses it. [Niebuhr & Tegtmeier 2019](https://doi.org/10.1007/978-3-030-20138-8_6) → audience during the take
- An interactive virtual audience improves expert ratings. [Chollet et al. 2015](https://doi.org/10.1145/2750858.2806060) → it reacts to eye contact and speaking (not pitch, so the cause stays visible)
- A hostile virtual audience raises anxiety. [Pertaub et al. 2002](https://doi.org/10.1162/105474602317343668) → default "friendly", "tough" is opt-in
- Self-view causes "mirror anxiety". [Fauville et al. 2023](https://doi.org/10.1016/j.chbr.2023.100271) → no self-view while speaking

## What feedback must look like
- Short one-word cues work, continuous meters confuse. [Tanveer et al. 2015](https://doi.org/10.1145/2678025.2701386) → at most one word, opt-in
- Several live displays overload speakers. [van Rosmalen et al. 2015](https://www.scitepress.org/Papers/2015/54231/54231.pdf), [Schneider et al. 2016](https://doi.org/10.1109/TLT.2016.2627043) → numbers only after the take
- Continuous feedback hurts retention (guidance hypothesis). [Salmoni et al. 1984](https://doi.org/10.1037/0033-2909.95.3.355)
- Feedback aimed at the person lowers performance in over a third of cases. [Kluger & DeNisi 1996](https://doi.org/10.1037/0033-2909.119.2.254) → no score
- Leaderboards lowered motivation. [Hanus & Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019) → no ranking
- Peer feedback gets used when it names the place and a fix. [Nelson & Schunn 2009](https://doi.org/10.1007/s11251-008-9053-x) → notes sit on timestamps: keep / change / try

## What the measures mean
- Up to 5 fillers/min have no negative effect, 12/min do. [Laske 2024](https://doi.org/10.1002/jaba.1093)
- More eye contact is not automatically more persuasive. [Chen et al. 2013](https://doi.org/10.1177/0956797613491968) → no target value, only "away" stretches
- Pitch variation correlates with perceived liveliness. [Hincks 2005](https://www.isca-archive.org/interspeech_2005/hincks05_interspeech.html) → not shown: semitone spread depends on the person and a laptop mic, unvalidated
- Power posing does not change behaviour. [Ranehill et al. 2015](https://doi.org/10.1177/0956797614553946) → no pose tips
- Investors fund preparation, not displayed passion. [Chen, Yao & Kotha 2009](https://doi.org/10.5465/amj.2009.36462018) → the Q&A hot seat brief

## Eye contact (estimate)
- People perceive eye contact within about ±4°, and are ~10× more tolerant below the lens than beside it. [Gamer & Hecht 2007](https://experimental.psychologie.uni-mainz.de/files/2024/06/2007gamer-hecht-gaze.pdf), [Chen CHI 2002](https://graphics.stanford.edu/papers/eye_contact/) → camera above the screen; we measure "gaze towards the lens area", not eye contact; a monitor above a laptop was counted as lens in the first test → dot calibration fits the person's own gain and offset (gaze → screen px, the usual webcam-tracker approach), so "above the screen" is a place of its own; the eye-contact check measures it
- Landmark/iris geometry breaks with head movement: 15° error with 1-shot calibration, ridge regression 3.8° → 31° when the head moves. [EMC-Gaze 2026](https://arxiv.org/abs/2603.12388) → v1's geometric gaze was replaced
- Appearance-based gaze on a normalised face crop factors out head pose. [Zhang et al. 2018](https://dl.acm.org/doi/10.1145/3204493.3204548), [ETH-XGaze, Zhang et al. 2020](https://ait.ethz.ch/xgaze) → ETH-XGaze ResNet-18 ([hysts weights](https://huggingface.co/hysts/ptgaze-eth-xgaze-resnet18), MIT; dataset research-only) on MediaPipe landmarks, in a worker
- Cross-dataset error of such models is 5–10°. [UniGaze 2025](https://arxiv.org/abs/2502.02307) → per-person calibration on the lens and the screen centre; if the two can't be told apart (d′ < 2), the studio says so instead of printing a number
- A camera beside the display is the weakest position for eye-contact detection. [Zhang et al. UIST 2017](https://www.collaborative-ai.org/publications/zhang17_uist.pdf)
- Not validated yet: 10 people × 2 min against hand coding is the next step before any accuracy claim.

## Speech, fillers, pace
- Whisper drops fillers; a filler-laden prompt brings them back. [OpenAI prompting guide](https://developers.openai.com/cookbook/examples/whisper_prompting_guide) → in our test (TTS speech) German fillers 0/10 → 10/10 with Whisper large-v3 turbo; real student recordings still to be checked
- Browser speech APIs (Chrome on-device, Safari) give no word timestamps. [Web Speech API](https://webaudio.github.io/web-speech-api/) → Whisper via [transformers.js](https://github.com/huggingface/transformers.js) on WebGPU, word timestamps from [whisper-large-v3-turbo_timestamped](https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped)
- Parakeet TDT v3 is fast but writes no German "äh" (0/42 in our test) and needs ≥1.2 GB on WebGPU. [parakeet.js](https://github.com/ysdede/parakeet.js) → not used in v2
- Filler detector on raw audio (DistilHuBERT, 20 ms frames). [Uhm, Desert Ant Labs](https://huggingface.co/desert-ant-labs/uhm) → second pass after the transcript; weights load from Hugging Face, "Powered by Desert Ant Labs"
- ASR-confirmed filler candidates raise F1 from 71 to 93. [Zhu et al. 2022](https://arxiv.org/abs/2203.15135) → detector hits inside real words are dropped
- Filled pauses are acoustically flat in pitch and spectrum. [Goto et al. 1999](https://www.isca-archive.org/eurospeech_1999/goto99_eurospeech.html) → fallback estimate when no model is available

## Recording in the browser (measured 2026-10-20/21)
- Chrome's WebM recordings have no duration (Infinity): seeking and the replay broke in v1 → v2 records MP4 (H.264 + AAC) in Chrome and Safari
- Chrome fires `start` up to 1.6 s late on the first H.264 recording while the file begins at `start()` → take time is measured from the call
- WebKit sometimes reports a bogus duration (7,158,280 s) for a correct MP4 blob → the player clamps to the measured length; every take is remuxed (packet copy, [Mediabunny](https://mediabunny.dev)) for a clean, fast-start file

## Law
- Emotion recognition in education is banned in the EU since 02/2025. EU AI Act Art. 5(1)(f), [FPF summary](https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/) → behaviour only
