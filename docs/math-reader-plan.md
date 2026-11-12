# Maths-aware photo reader: plan

Status: proposal, 2026-11-04. No code changed yet.

## The problem

The photo reader (`apps/web/src/solve/ocr.ts`, used by `pick.ts` and `sheet.ts`) is tesseract.js 5. Tesseract reads text one line at a time, so it flattens anything 2-D: `¾ + ⅙` comes back as "341", `2³` as "23" and `√144` as "V144". It reads handwriting badly too. `misreadFixes()` and `mathFromOcr()` patch the common cases after the fact, but they can't put back a fraction bar that was never read. The only path that handles real maths today is "Read with AI" (`packages/ai-engine/src/vision.ts`), and it needs a cloud provider.

What we need is a reader that outputs **LaTeX**, runs **on the device**, works **offline after one download**, and **says when it isn't sure**. The router already accepts LaTeX: `packages/runtime/src/router.ts` (line ~165) sends anything that looks like LaTeX through `delatex()` in `packages/math-core/src/natural.ts`, which handles `\frac`, `\dfrac`, `\sqrt`, `\int`, `\sum`, `\left/\right`, `\text`, `\operatorname` and more. Our engines still compute every number. The reader only transcribes.

## Recommendation

**Primary reader: Pix2Text MFR 1.5** (`breezedeus/pix2text-mfr-1.5`, MIT licence, released 2025-07-25). It's a TrOCR-style vision encoder-decoder that turns an image into LaTeX. The ONNX files are 120 MB at fp32 (87.5 MB encoder + 32 MB decoder), and we expect roughly 30–40 MB after int8 quantisation (our estimate; measure it). Its model card shows handwritten examples. It runs through `@huggingface/transformers` (`image-to-text` pipeline), the same library and worker pattern as `apps/web/src/whisper/worker.ts`.

**Fallback chain** (each step runs only if the one before it abstains):

1. **Pix2Text MFR 1.5**, on device, on each problem crop.
2. **TexTeller 3** (`onnx-community/TexTeller-ONNX`, Apache-2.0, about 300M params): an optional "bigger reader" download for desktop and laptops. It's about 200 MB at q4f16 or about 316 MB at int8. It's trained on 7.5M samples and claims handwriting support from v3.0 onward.
3. **tesseract.js**, kept as it is, for word problems and plain-text lines with no 2-D layout. It already gives us the line boxes we use to split a page into problems.
4. **"Read with AI"**, kept as it is: opt-in, the user's own provider, never automatic.

**Why this order:** Pix2Text is the smallest model with a permissive licence and a ready ONNX build. A 120 MB (or about 35 MB quantised) download is acceptable on a phone. TexTeller is more accurate but too heavy to make everyone download, so it's optional. Every other candidate fails on licence, size or maintenance (see the table). **Phase 0 is a bake-off on our own photos that confirms or overturns this pick before we build anything else.** Nobody publishes a like-for-like benchmark for these two models on school-style handwriting.

## Comparison

Sizes are the ONNX downloads on Hugging Face. Accuracy figures are the authors' own, which differ in metric and test set and are not comparable across rows. "UniMER-Test" is BLEU on printed simple (SPE), printed complex (CPE) and handwritten (HWE) subsets, from [UniMERNet paper, Table 5](https://arxiv.org/html/2404.15254v2).

| Model | Licence (commercial?) | Size | Printed / handwritten | Browser-ready ONNX | Notes |
|---|---|---|---|---|---|
| **Pix2Text MFR 1.5** ([card](https://huggingface.co/breezedeus/pix2text-mfr-1.5)) | MIT (yes) | 120 MB fp32 | CER chart only, no numbers in text; handwritten examples shown | Yes, but files sit at the repo root as a non-merged decoder; needs a re-export to the transformers.js layout | Smallest serious option. Updated Jul 2025 |
| **TexTeller 3** ([repo](https://github.com/OleehyO/TexTeller), [ONNX](https://huggingface.co/onnx-community/TexTeller-ONNX)) | Apache-2.0 (yes) | ~0.3B params; q4f16 ~202 MB, q4 ~256 MB, int8 ~316 MB | No published numbers; v3.0 (Jun 2024) adds "handwritten formulas" | Yes (onnx-community, transformers.js) | Best "big" fallback |
| **UniMERNet** T/S/B ([repo](https://github.com/opendatalab/UniMERNet)) | Apache-2.0 (yes) | 107M / 202M / 325M params; 441 MB / 773 MB / 1.3 GB downloads | SPE 0.909, CPE 0.902, **HWE 0.883** (tiny) | No ONNX published | Best published handwriting numbers. Converting it is the main candidate if Pix2Text fails on handwriting |
| **PP-FormulaNet_plus-S** ([card](https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S), [docs](https://www.paddleocr.ai/latest/version3.x/module_usage/formula_recognition.html)) | Apache-2.0 (yes) | 248 MB | En-BLEU 88.71; handwriting not stated | Paddle format; needs paddle2onnx | Heavier than Pix2Text with no handwriting claim |
| **Texify** ([repo](https://github.com/VikParuchuri/texify)) | GPL-3.0 code, CC BY-SA 4.0 weights | ~312M params; q4f16 ~254 MB | UniMER: SPE 0.906, HWE 0.341 | Yes ([Xenova/texify](https://huggingface.co/Xenova/texify)) | **Deprecated, archived Jan 2025.** Weak on handwriting |
| **pix2tex / LaTeX-OCR** ([repo](https://github.com/lukas-blecher/LaTeX-OCR)) | MIT (yes) | small (ViT+ResNet) | BLEU 0.88 on its own set; UniMER HWE **0.012** | Community scripts only | Printed only |
| **Surya LaTeX OCR** (successor to Texify) ([repo](https://github.com/VikParuchuri/surya)) | GPL code; weights free only under a revenue cap ($2M–$5M by source) | — | — | No | Licence rules it out |
| **PaddleOCR-VL 0.9B / 1.5** ([paper](https://arxiv.org/pdf/2510.14528), [ONNX](https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX)) | Apache-2.0 (yes) | 0.9B params, several hundred MB even at q4 | OmniDocBench formula CDM ~0.92 (authors) | ONNX exists; transformers.js support unconfirmed | Strong whole-page reader, too big for phones. Revisit for desktop in 2027 |
| **Handwriting-only research models** (CoMER, NAMER, PosFormer, Uni-MuMER) | Mixed / research | — | CROHME 2019 ExpRate 55–79% (varies by source) | No | Trained on CROHME/HME100K only and don't read printed maths |

**Latency:** none of these projects publish browser numbers. Our estimates, to be checked in Phase 0: a TrOCR-size model (~120M params) on a single cropped formula takes about 0.3–1 s on a laptop with WebGPU, 1–3 s on laptop WASM, and 2–6 s on a mid-range phone with WASM. TexTeller is roughly 2–3× slower. The UniMERNet paper reports 7.2 img/s for its tiny model on a GPU. Recognition scales with output length, so a 10-problem sheet means 10 crops run one after another.

## Native options inside the wrappers

None of the operating systems we ship on exposes maths recognition to apps.

- **Apple Vision** (`VNRecognizeTextRequest`): text only, no maths layout. Math Notes in Notes/Calculator is a user feature with no developer API ([MacRumors](https://www.macrumors.com/2025/06/12/ipados-26-math-notes-3d-graphing/)).
- **PencilKit `PKStrokeRecognizer`** (new in iOS/iPadOS/macOS 27, [WWDC26 session 203](https://developer.apple.com/videos/play/wwdc2026/203)): on-device handwriting recognition from strokes. Apple's session covers words and numbers only, not equations, and it doesn't accept photos.
- **Google ML Kit Text Recognition**: text only. **ML Kit Digital Ink** has language tags plus emoji, shapes and autodraw classifiers, but [no maths tag](https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models).

**Decision:** no native plugins. One ONNX path serves all four platforms. The one exception to reconsider is Electron, if WebGPU turns out slow there (see per-platform notes).

## Pipeline

```
photo / ink / screenshot
  → prepare()                      existing: greyscale, contrast, scale (ocr.ts)
  → split into problem regions     existing tesseract recognizeLines() boxes, merged into problem
                                   blocks using splitQuestions() numbering + vertical gaps;
                                   pad each box and grow it to cover tall glyphs (fractions span 2–3 "lines")
  → recognise each region          Pix2Text worker → LaTeX + per-token probabilities
  → normalise                      strip \displaystyle, \, spacing, \mathrm{d}x → dx, etc.
  → delatex → router               existing; the parse must succeed
  → confidence gate                see below: accept / flag / escalate to next reader
  → show                           crop thumbnail + rendered maths + editable text + answer (or "check this")
```

**Region detection.** Start with the tesseract line boxes we already have. Tesseract is good at *finding* lines even when it misreads them. Stacked fractions show up as 2–3 lines close together, and a gap-based merge joins them back. Add a dedicated detector only if the eval shows bad crops. The candidate is **Pix2Text MFD 1.5** ([card](https://huggingface.co/breezedeus/pix2text-mfd-1.5), MIT, 80 MB ONNX, built on CnSTD). Check its licence before shipping it, because YOLO-family training code is often AGPL even when the weights are tagged MIT. PP-DocLayout is another option but larger.

**Single-problem photos and the ink pad** skip detection and send the whole crop.

## Confidence and abstain strategy

Rule: **we never show a computed answer for a reading we think is wrong.** If a reading is flagged, the answer stays hidden until the user confirms or edits the maths.

A region is **accepted** only if all of these hold:

1. **Model confidence:** the lowest token probability is ≥ τ_min and the mean log-prob is ≥ τ_mean. transformers.js `generate()` returns scores with `output_scores: true`. We calibrate τ on the eval set so that fewer than 1% of accepted readings are wrong.
2. **It parses:** `delatex()` output goes through the router without an error, and the braces and `\left/\right` pairs balance.
3. **Cross-check against tesseract (printed only):** the digits the two readers found agree as a multiset. That catches dropped or invented digits. For "341" against `\frac{3}{4}+\frac{1}{6}`, the digits are {3,4,1} against {3,4,1,6}, so a digit is missing and the line is flagged.
4. **Sanity:** the output is short enough for the crop and doesn't loop on repeated tokens, a known failure mode of encoder-decoders.

If a region fails, we **escalate** to the next reader in the chain (TexTeller if it's downloaded). If that fails too, the line is shown **flagged**: the crop sits beside the rendered reading with "Check this. Tap to confirm or edit," and no answer is shown. When two readers disagree, both readings are offered as one-tap choices, the same way `misreadFixes()` works today. The existing behaviour of always showing what was read for editing stays.

## Download, caching and sizes

- The model loads **on first use only**. The core app costs nothing more, and the existing `warmOcr()` hook becomes `warmMathReader()` when the picker opens.
- The worker follows `whisper/worker.ts`: `pipeline('image-to-text', MODEL, { device: webgpu ? 'webgpu' : 'wasm', dtype })` with a progress callback ("Downloading the maths reader, about 35 MB, once").
- **Caching:** transformers.js stores model files in Cache Storage, and `apps/web/public/sw.js` already caches the transformers.js and onnxruntime-web CDN files. Together that gives offline use after the first download. Electron sets `env.cacheDir` to the user data folder, as `llm-worker.mjs` does.
- **Hosting:** the upstream Pix2Text repo isn't in transformers.js layout, so we publish a re-exported, quantised copy (`onnx/encoder_model_*.onnx`, `decoder_model_merged_*.onnx`) to a Hugging Face repo we control. It's a static file host, not an Lemma server. See open decision 1.
- **Budget:** Pix2Text int8 is about 35 MB (target ≤ 60 MB), and tesseract eng is about 10 MB (existing). TexTeller is an optional 200–320 MB download, offered only on desktop or when the user asks. Each download is shown in settings with a "Remove" button.

## Per-platform notes

- **Browser PWA:** WebGPU when available (Chrome/Edge, Safari 26+), WASM otherwise. Use fp32 or fp16 for the encoder on WebGPU, since quantised encoders lose accuracy there, as `whisper/worker.ts` already found. The decoder can use q4/q8.
- **Electron:** the renderer is Chromium, so the web worker path works unchanged with WebGPU. Move it into a utility process with onnxruntime-node (the pattern in `apps/desktop/llm-worker.mjs`) only if GPU blocklists make it slow on some machines. This is also the natural place to offer TexTeller by default.
- **iOS (Capacitor, WKWebView):** WebGPU in WKWebView follows the Safari version (iOS 26+). Check it on a real device and fall back to WASM. WKWebView memory is tight, so keep the phone default to Pix2Text only. Cache Storage can be evicted under storage pressure; on a cache miss the reader re-downloads and falls back to tesseract while it does. Never ship TexTeller as the default on iOS.
- **Android (Capacitor, WebView):** WebGPU availability in System WebView lags Chrome. Detect it at runtime and fall back to WASM with SIMD and threads (threads need cross-origin isolation, so check the Capacitor scheme headers). Low-RAM devices should get the quantised model and one crop at a time.

## Cloud fallback (opt-in only)

- **Keep "Read with AI" as it is.** It already exists, uses the user's own provider and key, is clearly opt-in, and returns LaTeX and query text that pass through our engines. When the on-device reader flags lines, add a "Try with AI" button on those lines only, shown only if a vision provider is configured.
- **Mathpix** ([pricing](https://mathpix.com/pricing/api)): the best dedicated maths OCR, at about **$0.002 per image** (Mar 2025 prices). It needs an app key, which means either an Lemma server (against our principles) or each user bringing their own Mathpix key. Images go to a third party. **Recommendation: don't include it now.** At most, it could become a bring-your-own-key provider later if users ask for it.

## Evaluation plan

- **Test set v1: 150 printed + 150 handwritten single problems**, plus **20 full worksheet photos** for region splitting. We collect them ourselves (phone photos of textbooks and worksheets, several handwriting styles, ink-pad renders) so the licence is clean. Each item gets ground-truth LaTeX and the expected answer. They cover fractions, powers, roots, equations, a few integrals and matrices, and include blur, tilt and poor-lighting cases. Store them in `stress/math-reader/` with a JSON manifest. CROHME 2019 can serve as a private extra check but doesn't go in the repo (research licence).
- **Main metric: answer match.** Push both the reading and the ground truth through `delatex → router` and compare the computed answers, so `\frac12` and `\frac{1}{2}` count as the same. Track exact LaTeX match as a secondary metric.
- **Targets:** printed ≥ 95% answer match, handwritten ≥ 80%, and **wrong-but-not-flagged ≤ 1%** overall. That last one is the release gate. Worksheet split: ≥ 95% of problems in their own crop. Median time per crop ≤ 1.5 s on a 2022 laptop (WASM) and ≤ 4 s on a mid-range phone.
- **CI:** a Vitest suite running under Node with onnxruntime-node uses the same ONNX files, with the model held in the CI cache. Every PR runs a 30-item smoke subset; the full set runs nightly and posts its per-category accuracy. Real-device latency is checked by hand once per release with a small timing page.

## Milestones (rough effort, one developer)

| Phase | What | Effort |
|---|---|---|
| 0. Bake-off | Collect the test set; re-export and quantise Pix2Text; run Pix2Text, TexTeller and (if feasible) UniMERNet-T in Node; pick the model and calibrate τ | 4–5 days |
| 1. Single-problem reader | Worker, pipeline, LaTeX → delatex, confidence gate, flagged UI in `pick.ts` and the ink pad; tesseract stays for plain text | 4–5 days |
| 2. Worksheets | Merge tesseract boxes into problem blocks in `sheet.ts`, per-crop recognition, tap-to-check UI | 3–4 days (+2 if MFD is needed) |
| 3. Fallbacks | Optional TexTeller download, "Try with AI" on flagged lines, settings for downloads | 2–3 days |
| 4. Platforms and CI | iOS/Android device checks, WebGPU/WASM fallbacks, nightly eval job | 3 days |

Total: about 3–4 weeks.

## Open decisions for you

1. **Model hosting:** publish our re-exported Pix2Text to a Hugging Face org we own (recommended), or bundle it in the Electron and mobile builds (+35 MB each, works offline from install)?
2. **Handwriting bar:** if Pix2Text misses the 80% handwriting target in Phase 0, do we convert UniMERNet-T (~2–3 extra days, roughly 100–200 MB quantised), or ship printed-first and label handwriting "beta"?
3. **TexTeller:** offer it on desktop only, or on phones too as an opt-in download?
4. **Mathpix:** leave it out (recommended), or add it later as a bring-your-own-key provider?
5. **Tesseract:** keep it for plain-text and word problems (recommended for now), or retire it once the maths reader covers worksheets?

## Sources

- Pix2Text MFR 1.5: https://huggingface.co/breezedeus/pix2text-mfr-1.5 · MFD 1.5: https://huggingface.co/breezedeus/pix2text-mfd-1.5 · release notes: https://pix2text.readthedocs.io/zh-cn/latest/RELEASE/
- TexTeller: https://github.com/OleehyO/TexTeller · https://huggingface.co/OleehyO/TexTeller · https://huggingface.co/onnx-community/TexTeller-ONNX
- UniMERNet: https://github.com/opendatalab/UniMERNet · paper: https://arxiv.org/html/2404.15254v2
- PP-FormulaNet: https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S · https://www.paddleocr.ai/latest/version3.x/module_usage/formula_recognition.html
- PaddleOCR-VL: https://arxiv.org/pdf/2510.14528 · https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX
- Texify (deprecated): https://github.com/VikParuchuri/texify · https://huggingface.co/Xenova/texify · Surya: https://github.com/VikParuchuri/surya
- pix2tex: https://github.com/lukas-blecher/LaTeX-OCR
- HMER results: NAMER https://arxiv.org/pdf/2407.11380 · leaderboard https://www.wizwand.com/task/handwritten-mathematical-expression-recognition
- ML Kit Digital Ink models: https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models
- PencilKit handwriting recognition: https://developer.apple.com/videos/play/wwdc2026/203 · Math Notes: https://www.macrumors.com/2025/06/12/ipados-26-math-notes-3d-graphing/
- Mathpix pricing: https://mathpix.com/pricing/api · https://mathpix.com/blog/image-api-price-reduction
