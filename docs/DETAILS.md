# Lemma: the details

Everything the [README](../README.md) leaves out: each feature area, the design decisions, measured speed and size, the stress tests and the full status table.

## Supported platforms

| Platform | How it runs | Tested |
|---|---|---|
| Chrome / Edge / Brave (desktop, Android) | Web or installed PWA | Playwright: Chromium, plus Pixel 7 emulation |
| Firefox 115+ | Web | Playwright: Firefox. Voice uses on-device Whisper here, since Firefox has no Web Speech |
| Safari 16.4+ / iOS 16.4+ (every iOS browser is WebKit) | Web or Home-Screen app | Playwright: WebKit, plus iPhone 14 emulation |
| Older Safari / iOS | Core calculator only, with an "update your browser" notice | The main bundle is checked for lookbehind regexes at build time |
| macOS (Apple Silicon and Intel) | `.dmg` | Packaged app self-tested, built-in AI included (Intel under Rosetta: native libraries only) |
| Windows x64 | NSIS installer | Packaged app self-tested under Wine, built-in AI included; not yet on a real Windows PC. Notifications need the AppUserModelID, which is set |
| Linux x64 | AppImage | Packaged app self-tested in an x64 Debian container (Xvfb), built-in AI included. The overlay is opaque (no compositor assumed) and "Open at login" is hidden |

The end-to-end suite fails a test on any uncaught page error. It covers the calculator and follow-ups, live preview, ambiguity choices, every engine, graphs (drawn and panned), SymPy (WebAssembly in all three engines), history/pins/formulas across reloads, timers, settings, the touch keypad, and the layout having no horizontal overflow.

## Desktop app

- **⌘/Ctrl + Shift + Space** opens the floating quick calculator on the current screen. **⌘/Ctrl + Shift + M** opens it and starts listening.
- In the overlay, `↵` saves the result, `⌘/Ctrl ↵` copies it and closes, and `esc` closes.
- A tray / menu-bar icon offers the overlay, the main window, "Open at login", and Quit. Closing the window keeps the app running in the tray.
- **Building:** `npm run desktop:dist` builds all four installers from one Mac. Native libraries (sharp, ONNX Runtime) come per platform, so it first fetches the other platforms' copies (`apps/desktop/scripts/sharp-binaries.mjs`, not saved to the lockfile). `.github/workflows/desktop.yml` builds each platform on its own runner instead, where `npm ci` installs the right ones, then self-tests each build. The installers are not code-signed yet.
- **Self-test:** `LEMMA_SMOKE=1` makes the app load both windows hidden, check a calculation in each, print the result and quit. `apps/desktop/scripts/smoke-packaged.mjs` runs it on a packaged build and fails if anything is wrong; `--ai` also asks the built-in model a question (downloads ~0.5 GB the first time). Pass a command after `--` to run it through Wine or `xvfb-run`.
- The shell serves the same web build through a private `lemma://` scheme. No local server, and no Node access in the renderer: it uses `contextIsolation`, `sandbox`, and a small preload bridge (overlay, sync folder, local model) that answers only the app's own page. Windows can't be navigated away from the app, and links open in your browser.

## Layout

```
packages/math-core     Lexer → Pratt parser → AST → Decimal evaluator. Natural-language normaliser,
                       session context (ans / "the original number" / variables), ambiguity detection,
                       formatting. No DOM, no framework: reusable from any platform.
packages/unit-engine   Unit registry (13 dimensions, ~120 units) and conversion parser. Lazy-loaded chunk.
packages/date-engine   Dates, durations, business days, ages, holidays, ISO weeks, Unix time, time zones (Temporal).
packages/finance-engine  Loans/amortisation, compound/simple interest, PV, CAGR, APY, NPV, IRR, ROI, plus shopping:
                       tips, bill splitting, tax/VAT, margin/markup, break-even, unit-price comparison.
packages/currency-engine 30 currencies, ECB reference rates via Frankfurter, with source and date on every answer.
packages/graph-engine  Graph requests → compiled float closures; adaptive sampling, marching squares, roots/extrema/
                       intersections. No DOM: the canvas view lives in apps/web/src/graph.
packages/symbolic-engine Natural language → typed SymPy requests (via Lemma's own parser, never raw text), the SymPy
                       program run in Pyodide, verification, and native BigInt number theory.
packages/stats-engine  Descriptive stats, regression, distributions, Bayes, confidence intervals and tests.
packages/science-engine Number bases, chemistry (periodic table, molar mass, balancing, pH, gas law), physics
                       constants and formula solvers, geometry.
packages/geometry-engine Dynamic geometry: construction dependency graph, intersections, measurements, commands.
packages/physics-engine RK4 fixed-step simulations (projectile, pendulum, spring, collision, incline) and presets.
packages/runtime       The shared intent router (lazy engine loading, plugin hooks, JSON output) used by the app,
                       the SDK and the CLI.
packages/productivity-engine Timers and study notes from plain language.
packages/practice-engine Practice questions with exact answers and worked steps (13 topics), answer checking, tests.
packages/tutor-engine    Lesson scripts in 10 teaching styles: explain a question or lecture a topic, verified math.
packages/exam-engine     Exam import (questions, keys, sections, timing), format profiles, exam building, scoring.
packages/lecture-engine  Lecture summaries from transcripts: key points, spoken formulas, definitions, outline.
packages/plugin-engine Extension format, validation, phrase templates, formula runner, no-code builder, catalog.
packages/sync-engine   Snapshots, per-record merge with tombstones, AES-GCM encryption. No server.
packages/discrete-engine Optimization, graph theory, numerical methods, cryptography, information theory, quantum.
packages/applied-engine  Applied sciences: physics, chemistry, engineering, computing, ML arithmetic, medicine.
packages/quant-engine    Quantitative finance, economics, business and risk; states the formula and inputs used.
packages/econ-engine     Inflation from a bundled published price index (no network).
packages/shape-engine    Shapes and triangles: areas, perimeters, solving from what's given, exact answers.
packages/reference-data  Physical constants and reference tables with lookups.
packages/steps-engine    Worked solutions for every kind of answer (symbolic steps come from SymPy).
packages/notebook-engine Notebook evaluation, data cells, import/export, Monte Carlo simulation.
packages/agenda-engine   The study agenda: tasks from plain language, spaced review, progress.
packages/ai-engine       Assistant providers, agent loop, prompts, vision, explain and check-work (see Phase 4).
packages/marketplace     Signed extension index: format, verification, build/sign CLI (PUBLISHING.md).
packages/sdk           `createLemma()` for JavaScript/TypeScript (browser or Node).
packages/cli           The `lemma` command: REPL, pipes, --json.
apps/web               Vanilla TypeScript UI, intent router, speech providers (Web Speech + on-device Whisper),
                       history/pins/formulas/timers, settings, service worker.
apps/desktop           Electron shell: overlay window, global shortcuts, tray, mic permissions, built-in model.
apps/mobile            Native iOS and Android apps (Capacitor). See apps/mobile/README.md.
apps/extension         Browser extension (Manifest V3). Store steps: apps/extension/STORES.md.
apps/sync-server       Optional self-hostable sync server; stores only encrypted blobs. See its README.
```

All non-calculator engines return one shared `Answer` schema (`packages/math-core/src/answer.ts`): a primary value, labelled detail rows, an optional table, notes, provenance for external data, and an optional action (timers). The UI renders any engine's output without special cases.

The math core does not depend on the UI. The UI talks to speech only through the `SpeechRecognizer`/`SpeechSynth` interfaces in `apps/web/src/speech.ts`, so you can swap in a Whisper or native recogniser without touching anything else.

## Design decisions

- **No LLM on any path.** Everything here runs locally and deterministically.
- **decimal.js at 50 digits**, so `0.1 + 0.2 = 0.3` and `sin(30°) = 0.5` exactly. A result is marked `≈` only when the display rounds it, and exact fractions (`1/3`) are shown when the value is rational.
- **Hand-written lexer and parser** rather than string replacement or math.js. That keeps the bundle small (27 KB gzipped for the whole app) and gives full control over ambiguity.
- **Ambiguous input is never resolved silently.** The parser applies standard precedence and shows the other reading as a clickable alternative:
  `20% of 450 + 30` → 120, *or* 20% of (450 + 30) = 96 · `6/2(1+2)` · `-2^2` · a leading "minus 15".
- **"a + b%"** follows the usual calculator convention (100 + 10% = 110), and the result says so.
- **Vanilla TS UI** instead of React, because startup time is the product. Advanced modules (graphing, notebooks) can bring their own framework as lazy chunks.

## Measured latency (Node, Apple Silicon, `npm run bench`)

| Operation | mean | p99 | Budget |
|---|---|---|---|
| Typed arithmetic `1250 / 4 + 18` | 0.015 ms | 0.045 ms | 5 ms |
| Spoken “what is twenty percent of 450 plus 30” | 0.011 ms | 0.024 ms | 5 ms |
| Scientific `sin(30) + sqrt(2) * ln(10)` | 0.23 ms | 0.47 ms | 5 ms |
| Unit conversion `8.5 miles to km` | 0.014 ms | 0.031 ms | 5 ms |
| Date: days until christmas | 0.18 ms | 0.29 ms | 5 ms |
| Loan + full 360-row amortisation | 0.71 ms | 1.18 ms | 5 ms |
| Voice → result, on-device Whisper (end of speech → committed) | ≈ 0.9 s | n/a | n/a |

The voice figure is dominated by the 600 ms pause that decides you've finished speaking. The final transcription starts speculatively 200 ms into that pause, so it's usually ready when the pause is confirmed. I measured it with synthetic speech in Chromium using WASM, not with a live microphone.

The test suite enforces these budgets (p99 < 5 ms). The UI shows each result's evaluation time.

## Phase 3: advanced mathematics

- **Graphing:** `graph sin(x) and cos(x)`, `y = 2x + 1`, `x^2 + y^2 = 25`, `y > x^2` (shaded), `r = 1 + cos θ`, `(cos t, sin t)`, `(1, 2)`, `x^2 from 0 to 3`, `graph x^3 and its derivative`. Any unknown letter becomes a slider (with ▶ to animate), as in Desmos. You can pan, zoom (wheel, pinch, + −), trace curves, and click roots, extrema, intercepts and intersections to pin them. Export to PNG. In Basic and Scientific a graph is drawn when you press Enter and stays until the next calculation; the live preview only ever shows numbers.
- **Calculator modes** (the Basic · Scientific · Graphing control at the top, Alt+1/2/3, or Settings → Answers → Calculator; each keeps its own input): **Basic** has the simple keypad; **Scientific** a full keypad (2nd/hyp trig, logs, powers and roots, n!, nCr/nPr, |x|, floor/ceil, mod, π e i, EE, ans, memory M+ M− MR MC, DEG/RAD); **Graphing** is a Desmos-style list of rows (functions, equations, inequalities, points, `a = 2` sliders, `f(x) = …` definitions) with colour dots, show/hide and delete beside one graph that never disappears while you edit. A row that doesn't parse yet keeps its last good curve, faded, with a short hint. Code: `apps/web/src/graphing/workspace.ts` (lazy).
- **Symbols** (+ Symbols, or Alt+S): search by name, alias or LaTeX command (`alpha`, `\leq`, `not equal`, `therefore`), browse groups (Greek, operators, relations, sets and logic, arrows, calculus, super/subscripts, fractions, geometry, units, currency, accents) or every Unicode math symbol (2,438, generated by `scripts/gen-symbols.py`), with recent ones first. It inserts at the cursor of the calculator, a graph row or a notebook cell. Save your own symbols or snippets; one with a value (ψ = 2.5) works in calculations. Lazy chunk: `apps/web/src/symbols/`.
- **Curve fits and statistical plots:** `fit a line to (1,2) (2,4.1) (3,5.9)`, `quadratic regression of …` (also cubic, exponential, power and logarithmic), `best fit for x=1,2,3 y=2,4,6`: the equation, R², residual notes and the points with the fitted curve, by exact least squares; models that can't apply say why (too few points, exponential with y ≤ 0). `histogram of …`, `box plot of …`, `dot plot of …`, `scatter plot (1,2) (2,4) …`, `normal curve mean 100 sd 15 shade above 130`, `shade P(-1<z<1)`. Every chart has a text summary for screen readers.
- **3D graphs:** `graph z = sin(x)*cos(y)`, `3d plot x^2 - y^2`. A colour height map in plain WebGL2 (a 16 KB chunk loaded on first use; a 2D renderer if WebGL is unavailable). Drag to rotate, wheel or pinch to zoom, arrow keys and + − on the keyboard.
- **Symbolic (SymPy):** derivatives, integrals (definite and indefinite), limits (one- and two-sided), solving (single, systems, inequalities, with a numeric fallback for transcendental equations), simplify / expand / factor / partial fractions, Taylor and Maclaurin series, ODEs (`y'' + y = 0`), Laplace transforms, matrices (det, inverse, eigenvalues and vectors, rank, null space, rref, arithmetic), and complex numbers (`sqrt(-4)`, `(2+3i)(1-i)`). Results are typeset with KaTeX and labelled **verified** when independently checked: antiderivatives are differentiated back, definite integrals are compared with numeric quadrature, solutions are substituted back, ODE solutions go through `checkodesol`, and inverses are multiplied back to the identity.
- **Geometry** (Study → Geometry, or type "open geometry"): a dynamic geometry canvas. Points, segments, lines, circles, polygons, midpoints, perpendiculars, parallels, intersections, and angle and length measurements, by tool or by typed/spoken command ("point A at (1, 2)", "circle centered A through B", "midpoint of AB", "perpendicular to AB through C", "intersect c1 and AB", "measure angle ABC", "undo"). Drag a free point and everything built on it follows. Snap to grid, keyboard control (] and [ pick, arrow keys move), PNG export, saved on the device. Code: `packages/geometry-engine` (construction graph, intersections, commands; no DOM) and `apps/web/src/geometry`.
- **Physics lab** (Study → Physics lab, or type "simulate a projectile at 20 m/s 45 degrees"): projectile motion with optional air drag, pendulum (exact or small-angle), damped spring–mass, 1D elastic/inelastic collisions and a block on an inclined plane with friction. Sliders, play/pause/step/reset, a live readout, an energy check and a plot. Fixed 1/240 s RK4 steps, so results are identical on every device; it starts paused when reduced motion is on. Code: `packages/physics-engine` and `apps/web/src/physics`.
- **Number theory (native, instant):** primality, factorization (Pollard rho, up to 10³⁰), divisors, next prime, nth prime, prime ranges, totient.

## Phase 4: AI assistant (optional, off by default)

Turn it on in **Settings → AI → Assistant** and pick where the model runs (key, model and server address are under *More*):

| Choice | Cost | Privacy | Notes |
|---|---|---|---|
| **Built-in** (default) | Free, no account | Runs on your device | Qwen3 0.6B (Apache-2.0, 570 MB, downloaded once). Uses WebGPU in browsers and runs natively in the desktop app (no GPU needed). Good for direct questions ("18% tip on $64.50", "5 miles in km"); can misjudge multi-step problems |
| **Ollama / LM Studio** | Free | Your machine | Any model you've installed; *Find local models* lists them. Best local quality (e.g. `ollama pull qwen3:8b`) |
| **Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek** | Your key (Gemini, Groq and OpenRouter `:free` models have free tiers) | The provider's terms | *Load models* lists everything your key can use; any model id can be typed |
| **Other** | | | Any OpenAI-compatible `/v1` endpoint (vLLM, llama.cpp server, Together…) |

Keys are stored per provider, on this device only.

**Why the built-in model is small (measured, not assumed):** Qwen3 1.7B gives noticeably better answers and runs well in Node, but a model that size can't load in browsers (WebAssembly's 4 GB address space: `std::bad_alloc` at 1.4 GB) or in Electron's main process (V8 sandbox limits: the process aborts). The 0.6B model works in both. For more capability locally, use Ollama or LM Studio.

**Guardrails for small models:**
- **Compact prompt:** the built-in model gets a 505-token prompt instead of 2,444 tokens. It's faster, and very long prompts stalled WebGPU in testing.
- **Grounding guard:** at the start of each turn, the reply is held back until it's checked. If the model answers with numbers but no `compute` call, or calls the graph tool when nobody asked for a graph, it is asked again and forced to start with a `compute` call. In testing, this caught a made-up "252 days until Christmas".
- **Browser direct access:** Anthropic requests from the browser carry `anthropic-dangerous-direct-browser-access: true`, verified against Anthropic's official TypeScript SDK. This is the bring-your-own-key pattern; no key is ever shipped with the app.

- **Assistant mode** (✦ button): ask in plain language, with follow-ups that keep context ("I'm buying a $250k house…", "what if the rate is 5%?"). Voice works here too.
- **Grounded by design:** the model gets two tools, `compute` (which runs Lemma's deterministic router) and `graph`. It's instructed never to calculate on its own. Every computation shows up as a chip (query → result, ✓ when verified), and clicking a chip opens it in the calculator.
- **Explain** on any result, at the level chosen in Settings: answer only, concise, detailed derivation, beginner or advanced. "Check my work" verifies each of your steps with the tools.
- **Ask the assistant** is offered (never sent automatically) when the calculator can't understand an input.
- **Photos and screenshots** (📷 or paste): a vision model transcribes the problem into **editable** queries without solving it. You fix any misreads, then calculate or ask for a step-by-step solution.
- **Under the hood:** `packages/ai-engine` holds the provider-neutral messages, two `fetch`-based providers with streaming, tool use, retries and clear error messages, the agent loop (max 8 steps, abortable with Esc), the prompts, vision extraction and explain/check-work. The assistant UI is a 15 KB chunk that loads only once AI is enabled.
- **Testing:** this was tested against a mocked Anthropic streaming API in all five browser projects, covering the tool round trip, grounding, Explain, the fallback offer, photo → editable query → calculate, and a bad key. It has **not been run against a live API key**. The built-in model has been run for real in the packaged desktop app on macOS, Windows (Wine) and Linux. The browser-direct-access header and the OpenAI-compatible streaming details were written from documentation and general knowledge.

## Phase 5: notebooks

Open with the notebook button or **⌘/Ctrl+Shift+N**; `#notebook` in the URL opens it directly.

- **Cells share one context.** A name defined in a cell (`rate = 0.05`, `f(x) = x^2 + 3x`) works in every cell below it. Editing a cell re-evaluates everything after it, so the page is never stale.
- **Cross-engine bindings:** `name = <any question>` and `name(x) = <any question>` store the *result* of any engine:
  - `df(x) = derivative of f(x)`, `area = integrate f(x) from 0 to 2` (SymPy)
  - `payment = monthly payment on $300k at 6% for 30 years` (finance)
  - `d = days until christmas` (dates)
  - then `solve df(x) = 0`, `graph f(x), df(x)` (with roots, extrema and intersections), and so on.
- **Data cells:** paste CSV or TSV, or import a `.csv` file. Columns become names, so `mean of temperature`, `summary of score` and `regression x: height y: weight` work.
- **Notes:** Markdown with `$math$`.
- **Defined bar:** lists every variable, formula and column currently in scope.
- **Slow engines don't block:** while SymPy downloads for the first time, cells that don't depend on it still compute. Lines that use a name still being computed show "Waiting for df…" rather than misreading it.
- **Send any calculator result to the notebook** with **＋ Notebook**.
- **Multiple notebooks**, saved on this device. **Export** as `.lemma.json` (re-importable, validated on import), **Markdown** with results (for docs, chats and repositories), or **Print / PDF**.
- **Code:** `packages/notebook-engine` (evaluation, bindings, data parsing, import/export; no DOM) and `apps/web/src/notebook` (view, runner, storage).

Not in this phase: Monte Carlo simulation cells, and an assistant scoped to a notebook ("ask about this notebook").

## Phase 6: ecosystem

**Study notes.** "note: chain rule is f'(g(x))·g'(x) #calc" saves a note with the math typeset. **Save note** under any answer keeps the question and result; notes can be filed into a notebook. They live under Study → Notes. (General reminders were removed; a study agenda is planned as Phase 8.)

**Whiteboard** (Study → Whiteboard, or say/type "open the whiteboard"): an endless canvas with pen, highlighter, eraser, text, shapes, pan and zoom, undo, PNG export and multiple boards saved on the device. Its command bar takes voice or typing, and what you say is done on the board:
- "solve 2x + 3 = 11 and circle the answer": writes the question and the worked steps, then circles the answer (a box by default; "just the answer" skips the steps).
- "graph sin x and x^2/4", "draw a number line from -5 to 5", "draw the coordinate plane", "draw a triangle".
- "write the chain rule is f'(g(x))·g'(x)" (math is typeset).
- "put the answer there" answers a question that's already on the board, next to it.
- "circle that", "box the answer", "underline it", "check it", "move it left", "erase that", "undo", "zoom in", "show everything", "clear the board", "stop listening".

Answers come from Lemma's own engines, never from a guess.

**Exam simulator** (Study → Exam simulator): practice in a room that matches the test you'll actually take.
- **Import** lecture notes, study guides, old tests and answer keys as PDF, photos (on-device OCR; its language data downloads once), text or paste. Lemma finds the questions, answer choices, points, sections, time limits, calculator rules, "show your work" and the answer key, and you can correct anything it got wrong.
- **Profile:** built from your teacher's tests, it mirrors them: same sections, order, timing, question count and mix, number of choices and point display, with letter grades. Without tests, start from a format: Digital SAT-, PSAT-, ACT-, AP-, GRE-, IB-style or a class test. Presets describe the format only and never contain official questions.
- **Questions:** variants of your own questions with new numbers and re-verified answers, plus generated questions on the same topics. Wrong answer choices come from real mistakes.
- **Rooms:** digital adaptive (timer you can hide, navigator, mark for review, answer eliminator, highlighter, reference sheet, Lemma as the calculator, modules and breaks), digital linear, printed paper (bubbles, points in the margin, show-work space, the whiteboard as scratch paper) and free response (multi-part answers with live math preview). Time warnings, auto-submit, locked sections and autosave are included.
- **Results:** a score in that test's terms (standardized-test scores are labelled as estimates), by section, topic and pacing, with "Practice this" and "Watch a lesson" on every missed question.

**Video lessons** (Study → Video lessons, "Create video" under an answer, or "teach me the chain rule in chalkboard style"): explain a question or lecture a topic in one of ten teaching styles: Chalkboard, Marker notes, Visual intuition, Lecture, Socratic, Exam prep, Quick tip, Beginner-friendly, Proof-first and Real-world story. Lessons are written out as they're narrated, with captions. The math comes from verified worked steps, and every "check" step is recomputed. Saved videos keep burned-in captions and a WebVTT file. Browsers can't record speech synthesis, so saved videos are silent.

**Study tools** (the Study button):
- **Practice:** a question at a time in 13 topics and three levels, with answer checking that accepts equivalent forms, hints and worked steps. **Practice question** under an answer starts with a question like the one you just asked.
- **Practice tests:** 5, 10 or 20 questions, scored by topic, with a review, worked steps and "retry the ones I missed".
- **Lecture summarizer:** record, upload or paste a lecture. Transcription runs on the device (Whisper) and the recording is never saved. The summary lists key points, the formulas that were spoken (as real math), definitions, examples and a timed outline, and can be saved to notes or a notebook.

**Continuous voice.** Turn on the loop button next to the mic, or "Keep listening" in Settings → Voice, and Lemma keeps listening until you stop it. Each step chains from the last result on a running tape: "12 plus 8", "times 3", "minus 5", "square root of that". Saying several steps at once works too: "5 plus 3 then times 2 then minus 4" runs in the order spoken. Say "undo" to drop the last step, "start over" to clear, and "stop" to finish.

**Look.** Comfy is the default: soft colours, rounded type and no fine print. Settings → Look has six themes (Comfy, Paper, Dusk, Ocean, Classic, High contrast) in light and dark, text size and Motion (Normal or Calm; *Customize motion* switches off answers and lists, panels and screens, graphs and lessons, right/wrong/done feedback, button press or the mic pulse one by one), with accent colour, font, spacing and corners under *More*. **Extra details** (Settings → Answers) brings back timings and engine notes.

**Extensions** (Settings → Add-ons):
- *Formula* extensions run no code. They declare inputs, phrase templates ("bmi {weight} kg {height} m") and an Lemma formula. The no-code builder makes these.
- *Script* extensions run inside a sandboxed iframe with a strict CSP, in a Worker. They can't see the app, its storage or your keys, have no network unless you approve specific hosts, and are stopped after 2 s. They can call Lemma itself. A hostile extension (one that spins forever, reads storage, probes the parent or calls the network) is part of the e2e suite.
- Phrase templates compile to linear-time patterns; extensions cannot supply regular expressions.

**Encrypted sync and backup** (Settings → Data; the sync folder and server are under *More*):
- **Encryption:** everything is encrypted on the device with your passphrase before it's written: PBKDF2-SHA-256 with 600,000 rounds, then AES-256-GCM. Passphrases need at least 10 characters and must pass a strength check.
- **No server:** nobody, including Lemma, can read the file, and a lost passphrase can't be recovered.
- **What syncs:** history, notebooks, formulas, variables, notes, the study agenda, exam history and settings. API keys and per-device settings never do. Whiteboards and saved video lessons stay on the device (videos are too large for a backup).
- **Restore merges** instead of overwriting. Each record keeps the latest edit, and deletions sync as tombstones.
- **Desktop folder sync:** choose a folder (iCloud Drive, Dropbox, OneDrive…), and the app syncs at launch, on focus and every 5 minutes. The passphrase can be kept in the OS keychain (Electron `safeStorage`).
- **Caveat:** tombstones are kept for 90 days, so a device that has been offline longer can bring a deleted item back.

**Developer API.**

```ts
import { createLemma } from '@lemma/sdk';
const om = await createLemma({ liveRates: false });
await om.compute('15% tip on 84.50');      // { ok: true, display: '$12.68', lines: [{ label: 'Total', display: '$97.18' }], ... }
await om.compute('split that 3 ways');     // { display: '$32.39', ... }: follow-ups work, like in the app
await om.compute('note: chain rule is f\'(g(x))·g\'(x)'); // { action: { type: 'note', text: '…' } }
```

Timers and notes come back as an `action` for your app to carry out; the SDK and CLI don't store or run them.

```sh
lemma "derivative of x^3"               # 3*x^2
echo "5 km to miles" | lemma --json     # one JSON object per line
lemma                                   # interactive REPL
```

The CLI is a single 0.7 MB file (`packages/cli/dist/lemma.mjs`, Node 20+). SymPy-backed answers use Pyodide when it's installed. Exit code 1 means an error.

See [ROADMAP.md](../ROADMAP.md) for phases 5–7, including the planned browser extension.

## Size and speed (measured on the production build)

| What | Result |
|---|---|
| First load (HTML, CSS, main bundle and the core engines) | 98 KB over the network, 16 requests; first paint ≈ 36 ms on a local server |
| Main bundle | 50 KB (18 KB gzipped); everything else loads on first use |
| Whole web build, every optional feature included | 17 MB (PDF reader, OCR, math fonts, exam rooms, 3D…), of which a session only fetches what it uses |
| Answer time in the browser | arithmetic, %, units, statistics, curve fits: 3–10 ms; the very first answer ≈ 33 ms while the engines warm up |
| First symbolic question (derivatives, integrals) | about 56 ms once everything is loaded (≈ 3.4 s without it, while Python starts) |
| Everything ready after opening | ≈ 3.4 s in the background (Settings → Data → "Load on start", on by default; skipped on data-saver and mobile data) |
| Live preview while typing | ≈ 2 ms a keystroke |
| Memory | about 10 MB of JS heap after a tour of every engine, unchanged after 200 more answers |
| Browser extension | 5.3 MB zip (most of it is the on-device OCR engine) |
| Desktop installers | macOS 144 MB (Apple Silicon) / 136 MB (Intel), Windows 152 MB, Linux 154 MB. Electron's own runtime is most of it; each carries only its own platform's native AI runtime (Intel Macs use the in-app one) |
| Phone apps (bundled web files) | 17 MB |

## Stress and limit testing

`stress/engines.stress.test.ts` and `e2e/stress.spec.ts` run with the normal suites. Invariants: nothing throws, nothing hangs, and results at the limits are correct or explicitly refused.

| Test | Result |
|---|---|
| 10,000 fuzzed phrases × every engine | No exceptions; slowest call 5.6 ms |
| Adversarial input (22 patterns: 10k digits, 5k nested parens, 10k negations, 20k-number lists, unicode, NUL…) | All under 250 ms per engine |
| 10,000-term sum, 5,000-term product | Correct (evaluator and printer handle long chains iteratively) |
| Numeric limits (10^10^10, 10^-1000, 5000!, 0^0, tan 90°…) | Correct or refused with a typed error |
| Graphs: 11 pathological functions × 4 extreme zooms; 20 curves at once | Under 60 ms a frame, no non-finite points drawn |
| 500-cell notebook / 20,000-row CSV / hard factorizations | 17 ms / under 500 ms / under 3 s |
| UI: 400 rapid keystrokes, 50,000-character paste, 1,000-entry history, 50 timers, 200-cell notebook, 200 zoom/pan events, storage that throws | Pass in Chromium, Firefox, WebKit, Android and iPhone emulation |

**Bugs this found, now fixed:**
- **Freezes on long lists:** a quadratic word-window scan in the finance parser froze a pasted 20,000-number list for 9.8 s.
- **Slow digit runs:** unanchored regexes were quadratic on long digit runs (340 ms for a 10,000-digit number).
- **Long sums failed:** a 10,000-term sum overflowed the call stack in Chromium and Firefox.
- **Lost commits:** pressing Enter while an engine was still loading lost the commit if you kept typing.
- **Digit variable names:** `x1`, `v0` and similar were read as `x × 1`.
- **Currency in arithmetic:** "18% of $64.50" was rejected.

**Live desktop test (packaged macOS app, driven through the accessibility API) found and fixed:**
- **No Dock icon or menu bar:** the overlay's `setVisibleOnAllWorkspaces(…, { visibleOnFullScreen: true })` turned the whole app into a background process on macOS. It now passes `skipTransformProcessType`.
- **Wrong app name in menus:** menus read "Quit @lemma/desktop". The app now names itself Lemma and keeps its existing data folder.
- **"on the 1st" ignored:** "remind me to pay rent on the 1st at 9am" was set for today with "on the 1st" left in the label.
- **Disabled buttons looked enabled,** for example "Sync now" with no folder and the passphrase dialog's Continue.
- **Long answers wrapped mid-phrase** ("9:00 / AM"), and non-calculations showed a stray "=" ("Note =").

## Status

| Capability | State |
|---|---|
| Arithmetic, %, powers, roots, factorial, mod, abs, sci-notation, fractions | Implemented |
| Scientific functions (trig/inverse/hyperbolic, logs, nCr/nPr, gcd/lcm, rounding), DEG/RAD | Implemented |
| Natural language: number words, spoken fractions, operator words, "% off", "increase X by Y%", sum/product/average of | Implemented |
| Conversation context: ans / that / it, "the original number", "now subtract 15", variables (`x = 5`, `a = 3, b = 4`, `r := 2`, "let rate be 0.2", "store 7 in m") | Implemented. Variables and formulas show as chips under the input (click to insert, × to delete); the Variables button adds one |
| Tips (the ? in the header): every typed and spoken command and shortcut that has no button of its own, each tappable | Implemented |
| Unit conversion, multi-target (`10 kg to lb, oz`), "how many feet in a mile" | Implemented |
| Voice input with live partial results; read-aloud results | Implemented. There are two engines: the browser's Web Speech API, and on-device Whisper (`whisper-tiny.en`, ~40 MB, downloaded once from Hugging Face, then offline). Automatic mode uses Web Speech where it works and Whisper elsewhere (Firefox, the desktop app). Not yet tested with a real microphone |
| Offline | Calculation, dates and finance: fully offline. Currency: works offline with cached rates (marked stale after 4 days). Whisper voice: offline after the model download. Web Speech: depends on the browser |
| Desktop shell: global hotkeys, floating overlay, tray, open at login | Implemented (Electron). Tested live on macOS; Windows (Wine) and Linux (container) packaged builds pass the self-test. Installers are not code-signed yet |
| Dates & times: until/since/between, business days, date arithmetic, weekday, age, leap years, ISO week, day of year, Unix time, time in a city, time-zone conversion, holidays & Easter | Implemented. Business-day counts also show the count without public holidays |
| Finance: loan/mortgage payment + amortisation, compound/simple interest with contributions, PV, CAGR, APY, NPV, IRR, ROI | Implemented. Missing inputs trigger a question, never a default |
| Shopping: tips (with a rate table), bill splitting, sales tax / VAT (forward and reverse), margin/markup, break-even, unit-price comparison incl. multipacks | Implemented |
| Currency conversion (30 currencies, multi-target) | Implemented. Needs one online fetch; mid-market rates only, no fees |
| Custom formulas `f(x) = …`, pinned results, timers (concurrent, survive reload, chime and notification) | Implemented. Timers only run while the app is open |
| History, recall (↑/↓), copy, keypad, themes, settings, PWA install | Implemented |
| 2D graphing: explicit, x = f(y), implicit, inequalities, parametric, polar, points, sliders and animation, trace, points of interest, PNG export | Implemented |
| Regression curves on data (linear, quadratic, cubic, exponential, power, logarithmic), statistical plots (histogram, box, dot, scatter, shaded normal curve), 3D surfaces | Implemented |
| Dynamic geometry canvas (constructions, measurements, live dragging), physics simulations (projectile with drag, pendulum, spring, collisions, incline) | Implemented. Fixed-step RK4; energy checked in tests |
| Symbolic algebra and calculus, ODEs, Laplace, linear algebra, complex numbers (SymPy in Pyodide) | Implemented. The first use downloads ~12 MB and starts Python (about 18 s measured in a Chromium pane; it depends on the connection), then each answer typically takes about 60 ms (up to a few seconds for hard integrals). Computations are cut off after 30 s |
| AI assistant: plain-language questions, follow-ups, explanations (5 levels), check my work, photo/screenshot → editable problems, Anthropic + OpenAI-compatible (incl. local Ollama) | Implemented (opt-in). Tested against mocked APIs only |
| Notebooks: shared variables/functions, cross-engine result bindings, data cells, graph cells, live re-evaluation, export JSON/Markdown/PDF | Implemented |
| Study notes with typeset math, save any answer, file into notebooks | Implemented |
| Practice questions and tests, lecture summarizer, step-by-step videos and gallery | Implemented. Lecture transcription is on-device and untested with a real microphone |
| Continuous voice with chained steps, undo and start over | Implemented. Not yet tested with a real microphone |
| Themes and appearance (6 looks × light/dark, accent, font, size, spacing, corners, motion) | Implemented |
| Extensions: formula and sandboxed script extensions, catalog, no-code builder, import/export | Implemented |
| Extension marketplace: Ed25519-signed index, Marketplace tab with search, categories and updates (`packages/marketplace`) | Implemented. Works from the copy bundled with the app; set `MARKETPLACE_URL` once `packages/marketplace/site/` is hosted |
| Encrypted backup, restore and merge; desktop sync folder | Implemented |
| Photo solve (📷, paste or drop: photos, several at once, or a PDF): every problem read on the device and solved as a card with its part of the photo, answer and steps; follow-ups by typing or voice. Draw a problem by hand | Implemented. A line the reader isn't sure of is shown for checking, never answered on its own. With a vision-capable AI provider set up, a single photo goes to it instead |
| Sync server (`apps/sync-server`): stores only encrypted blobs, optimistic concurrency, rate limits, unused spaces expire after 180 days | Implemented. Needs an HTTPS host (Dockerfile and Fly/Render/VPS steps included) |
| SDK and CLI | Implemented |
| Native iOS/Android apps (`apps/mobile`, Capacitor 8) | Implemented. iOS builds and runs in the Simulator; Android is generated but not compiled here. Store accounts and signing are the owner's |
| Monte Carlo simulation (`simulate 10000: sum of 2 dice >= 10`) in notebooks and the main input, notebook-aware assistant | Implemented. The main input runs up to 200,000 trials; notebooks run up to 2,000,000 in a Worker |
| Inflation (US CPI-U 1913–2024), historical exchange rates (ECB, from 1999), public holidays for 10 countries in business-day counts | Implemented. Historical rates need one fetch per date, then work offline |
| Browser extension (Chrome, Edge, Firefox, Safari): popup, side panel, selection actions, screen capture with OCR, tutor mode, fill-in answers | Implemented. Store listings are the owner's to publish; "Add to browser" picks the most automatic install each browser allows |
| Study agenda: tasks from plain language ("add a task: problem set 4 due Friday"), spaced review, progress and streaks | Implemented. Synced with the rest |
| Exam simulator (with a DEG/RAD exam calculator), video lessons in ten teaching styles, whiteboard with hands-free voice | Implemented |
| Load everything (Settings → Data, or type "load everything"): every engine and tool, Python and SymPy, an offline copy of every file, optionally the voice and AI models. Also predictive warm-up (typing "derivative…" starts the algebra engine before Enter) and Study tools that load when pointed at | Implemented |
