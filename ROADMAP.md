# Lemma roadmap

Each phase ships working software; the instant calculator never gets slower to serve a later phase.

| Phase | Theme | State |
|---|---|---|
| 1 | Core calculator: voice, parser, exact arithmetic, history | Done |
| 2 | Everyday utilities: units, dates/time zones, finance, shopping, currency, timers, formulas | Done |
| 3 | Advanced maths: graphing, SymPy algebra/calculus, statistics, science, number theory | Done |
| 4 | AI layer: grounded assistant, explanations, check-my-work, photo → problem | Done (tested against mocked APIs) |
| 5 | Unified environment: notebooks, shared variables, cross-engine workflows, data, export, simulation cells, notebook-aware assistant | Done |
| 6 | Ecosystem and study tools: study notes, practice, exam simulator, lecture summaries, video lessons, whiteboard, extensions and marketplace, encrypted sync and sync server, SDK and CLI, native mobile apps | Done |
| 7 | Browser extension | Done |
| 8 | Study agenda | Done |

What's left is outside the code: store accounts and code signing (Apple, Google Play, Microsoft, the extension stores), and hosting for the web app, the sync server and the marketplace index.

## Phase 6: AIO ecosystem

Shipped:
- **Study notes** by voice or typing, with math typeset ("note: chain rule is f'(g(x))·g'(x)"), one-tap "Save note" on any answer, and filing into notebooks. Voice notes are stored as text; audio is never kept. (General-purpose reminders were removed: they return only as the study agenda in Phase 8.)
- **Study tools:** practice questions with hints and worked steps, practice tests scored by topic, a lecture summarizer (record or upload; on-device transcription), and step-by-step lesson videos with a local gallery.
- **Exam simulator:** import notes, study guides and old tests, then take a timed exam in a room that matches the real one (your class format, or SAT-, ACT-, AP-, GRE- or IB-style), scored the same way, with practice and lessons on every miss.
- **Video lessons in ten teaching styles**, for any question or topic.
- **Whiteboard:** an infinite canvas you can draw on or talk to: "solve … and circle the answer", "graph …", "draw a number line", "put the answer there".
- **Continuous voice:** keep listening until you say stop, chaining steps ("12 plus 8 … times 3 … minus 5") on a running tape, with "undo" and "start over".
- **Extensions:** a JSON format with no-code *formula* extensions and sandboxed *script* extensions, a curated catalog, a no-code tool builder, and import/export.
- **Encrypted sync without a server:** encrypted backup files on every platform, plus a sync folder (iCloud Drive, Dropbox, OneDrive…) in the desktop app.
- **Developer API:** `@lemma/sdk` for JavaScript and the `lemma` CLI, both on the same router as the app.

Also shipped:
- **Native iOS and Android apps** (`apps/mobile`, Capacitor), bundling the web app so they work offline.
- **Extension marketplace:** a signed index (Ed25519) with search, categories and updates, bundled with the app and ready to host (`packages/marketplace`).
- **Sync server** (`apps/sync-server`) for automatic phone ↔ computer sync without a shared folder. It only ever sees encrypted data.

## Phase 7: Browser extension (done)

Lemma inside the browser: the same engines and voice, available on any page.

- **Popup and side panel:** the full calculator, history and notebooks, sharing state with the installed app where the browser allows it.
- **Selection actions:** select text such as `3x + 7 = 22`, a price or a date range, then right-click → *Calculate*, *Solve*, *Convert*, *Graph*. Results appear inline next to the selection.
- **Solve what's on the screen:** capture the visible tab or a dragged region. The photo pipeline from Phase 4 transcribes it into **editable** problems, which run through the deterministic engines.
- **Tutorial / step-by-step mode:** for a problem on the page, show the method first: hints in increasing detail, then a full derivation grounded in tool results, then the answer. *Explain this step* works on any line.
- **Fill in answers:** write computed results into input fields on the page, each with an inline check mark showing it was verified.
  - Always started by you, one field at a time or a reviewed batch.
  - Never submits anything.
- **Learning-first defaults:** tutor mode (steps before answers) is the default. Filling is off on domains you mark as assessments, and teachers and schools can enforce that through managed-policy settings. On graded tests, instant answers would undercut learning and break most institutions' rules; on practice, worksheets and your own forms, they save real time.
- **Page awareness:**
  - Recognise math notation in the page DOM: MathML, KaTeX/MathJax source, and inline LaTeX.
  - Recognise tables, so "average of this column" works.
  - Recognise prices, so unit-price comparisons work while shopping.
- **Privacy:** the extension reads a page only when you invoke it (`activeTab`), with no background reading of pages. Computation is local; screen capture goes to the AI provider only if you use *Solve what's on the screen* with AI turned on.
- **Engineering:** Manifest V3 for Chrome, Edge and Firefox, plus a Safari Web Extension built with Xcode, all using the same workspace packages. The engines are already DOM-free and environment-agnostic, so the extension is a new shell like `apps/desktop`, not a rewrite.

## Phase 8: Study agenda (done)

Reminders come back only as a study planner that earns its place by helping you study:

- **Tasks tied to the math:** "Problem set 4 due Friday, 12 problems", checked off as you solve them in Lemma.
- **Spaced review:** suggestions like "review integrals today", based on what you got wrong in check-my-work and practice tests, and what you haven't practised lately.
- **Progress:** problems done per topic, and streaks.
- **Synced** through the existing end-to-end encrypted sync.

It's a phase of its own, built alongside the Phase 7 extension's tutor mode, not a tweak.
