# Publishing the Lemma extension

One build produces every store package:

```bash
npm run build -w @lemma/extension
# dist/lemma-chrome.zip   → Chrome Web Store, Microsoft Edge Add-ons (Brave, Arc and Vivaldi install from the Chrome Web Store)
# dist/lemma-firefox.zip  → addons.mozilla.org (AMO)
# dist/chrome/               → input for Safari's converter (see safari/README.md)
```

Before every submission, bump `version` in `apps/extension/package.json`. The build copies it into both
manifests, and every store rejects an upload whose version isn't higher than the last one.

**No website can install an extension by itself.** Every browser requires the user to click an install
button and confirm a permission prompt. The best a website can do is link to the store listing (or, for
Firefox, to a signed `.xpi`) so installing takes one or two clicks.

---

## What the code actually does (use this for every privacy form)

| Question | Answer, matching the code |
|---|---|
| Data sent off the device | None. Calculations, worked steps, lessons, graphs and OCR all run locally (`src/core/solve.ts`, `src/ui/ocr.ts`). |
| Page access | Only after a user gesture (context-menu item, toolbar popup, or Alt+Shift+S), through `activeTab`. There are no host permissions and no declared content scripts. `content.js` is injected on demand into that one tab. |
| What is read from the page | The current selection (text, and the MathML/KaTeX/MathJax source or table column it covers), plus a screenshot of the visible tab when the user runs "Solve what's on screen". The screenshot is cropped to the dragged region, read by OCR in the extension, and discarded. It is held in `storage.session` only until the review page picks it up. |
| What is written to the page | A result bubble in a shadow root. With Fill, the answer is written into the one field the user picked, with a check badge. Forms are never submitted. |
| Stored data | `storage.sync`: settings (tutor style, tutor/answer mode, learning-first, assessment domains, theme). `storage.local`: calculator history. `storage.session`: hand-off between the background and the side panel. |
| Network requests | One, optional: if `vendor/eng.traineddata.gz` wasn't present at build time, the first OCR use downloads the English language data (2.9 MB) from `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz` and caches it in the extension's IndexedDB. That request carries no user or page data. Drop the file into `apps/extension/vendor/` before building to bundle it, which removes the request entirely. |
| Remote code | None. All JavaScript and WebAssembly (tesseract.js worker and core) are in the package. The language data is data, not code. The build fails if a page has an inline script or a remote `src`, or if the background or content script has `eval`/`new Function` or module syntax (`scripts/build.mjs`). |
| Analytics, ads, accounts | None. |

Code reviewers may find these strings. None of them runs:
- `api.frankfurter.dev` in the bundled currency engine. The extension never enables live exchange rates
  (`requestRates` isn't passed to the runtime), so this URL is never fetched.
- A dead `new Function("return this")` fallback in tesseract.js's `worker.min.js`. It only runs when
  `globalThis` is missing, which never happens in a supported browser.
- Default `cdn.jsdelivr.net` worker and core URLs in tesseract.js. They are overridden with
  `chrome.runtime.getURL(...)` in `src/ui/ocr.ts`.

---

## Chrome Web Store (Chrome, Brave, Arc, Vivaldi)

1. **Developer account.** Go to https://chrome.google.com/webstore/devconsole, sign in with the Google
   account that will own the listing, accept the developer agreement, and pay the one-time **US$5**
   registration fee. Turn on 2-Step Verification for that account (required to publish), and verify the
   contact email under Account.
2. **Upload.** Click **New item** and upload `dist/lemma-chrome.zip`. The manifest is read from the zip
   root.
3. **Store listing** tab (required fields):
   - Description: what it does in a few lines. Use the feature list in this file.
   - Category: **Education** (or Tools). Language: English.
   - Store icon: 128 × 128 PNG (`dist/chrome/icons/icon-128.png`).
   - At least one screenshot, 1280 × 800 or 640 × 400 (popup, bubble on a page, side panel with steps).
   - Small promo tile: 440 × 280.
   - Optional: marquee 1400 × 560, homepage URL (`https://lemma.app`), support URL.
4. **Privacy practices** tab:
   - **Single purpose:** "A calculator and step-by-step math tutor that works on the math the user selects
     or captures on the current page."
   - **Permission justifications:**
     - `activeTab`: "Reads the user's selection, shows the result next to it, and captures the visible tab
       for 'Solve what's on screen', only on the tab where the user just clicked the menu item, the toolbar
       button or the keyboard shortcut."
     - `contextMenus`: "Adds Lemma → Calculate / Solve step by step / Convert / Graph / Explain to the
       right-click menu for selected text."
     - `scripting`: "Injects the extension's own content script into the active tab after one of those
       actions, to read the selection, draw the result bubble and screen-region overlay, and fill an answer
       into the field the user picked. Nothing is injected without a user action."
     - `storage`: "Saves settings, calculator history, and hands a captured region from the background
       to the side panel."
     - `sidePanel`: "The side panel shows the calculator, worked steps, lessons, and the editable text read
       from a screen capture."
   - **Remote code:** "No, I am not using remote code." All JS and WebAssembly ship in the package. The
     optional OCR language download is a data file.
   - **Data usage:** check none of the data types. Nothing is collected or transmitted. Then certify the
     three statements (not sold to third parties, not used for unrelated purposes, not used for
     creditworthiness).
   - **Privacy policy URL:** host the privacy text from `src/options.html` (for example at
     `https://lemma.app/privacy`) and link it.
5. **Distribution** tab: Public (or Unlisted for a beta), and all regions.
6. **Submit for review.** Extensions with only `activeTab` and no host permissions usually clear review in
   a few days. Fix and resubmit if rejected. The reason is listed on the item page.
7. **Install link for the website:** `https://chromewebstore.google.com/detail/<item-id>`. The user clicks
   "Add to Chrome" and confirms. Chrome removed inline installation from other websites in 2018.

## Microsoft Edge Add-ons

1. Register at https://partner.microsoft.com/dashboard/microsoftedge (Microsoft Partner Center, Edge
   program). Registration is free.
2. **Create new extension** → upload the same `dist/lemma-chrome.zip`. Edge supports `sidePanel`, MV3
   service workers and `activeTab`.
3. **Availability:** public or hidden, and markets.
4. **Properties:** category (Education or Productivity), privacy policy URL, website and support contact.
   "Does this extension access, collect or transmit personal information?" → **No**, as explained in the
   table above.
5. **Store listing:** description, 300 × 300 logo (render it from `apps/web/public/icon.svg`), screenshots
   1280 × 800 or 640 × 480, optional promo tiles.
6. **Submit**, with optional notes for certification: "Select 2x + 3 = 11 on any page → right-click →
   Lemma → Calculate." Certification can take up to 7 business days.
7. Install link: `https://microsoftedge.microsoft.com/addons/detail/<product-id>`.

## Firefox: addons.mozilla.org (AMO)

1. Create a Mozilla account at https://addons.mozilla.org/developers/. It's free.
2. Check the package locally:
   ```bash
   npx web-ext lint --source-dir apps/extension/dist/firefox
   npx web-ext run  --source-dir apps/extension/dist/firefox   # temporary install in a fresh profile
   ```
   (`web-ext` isn't a dependency of this repo, so `npx` downloads it on first use.)
3. Decide between **listed** and **self-distributed (unlisted)**:
   - **Listed:** the add-on has a public AMO page, gets automated plus possible human review, and Firefox
     auto-updates it from AMO. Users install from the AMO page ("Add to Firefox" → permission prompt → Add).
   - **Unlisted (self-distributed):** AMO only signs it (automated review). You get a signed `.xpi` to host
     yourself, and AMO doesn't list it. For auto-updates, add
     `browser_specific_settings.gecko.update_url` to the Firefox manifest in `scripts/build.mjs`, pointing at
     an updates JSON you host.
4. **Sign and upload.** Either:
   - Web: Developer Hub → **Submit a New Add-on** → choose listed or "On your own" → upload
     `dist/lemma-firefox.zip`.
   - CLI: create API credentials under Developer Hub → Tools → Manage API Keys, then
     ```bash
     npx web-ext sign --source-dir apps/extension/dist/firefox --channel listed   --api-key $AMO_JWT_ISSUER --api-secret $AMO_JWT_SECRET
     npx web-ext sign --source-dir apps/extension/dist/firefox --channel unlisted --api-key $AMO_JWT_ISSUER --api-secret $AMO_JWT_SECRET  # signed .xpi in web-ext-artifacts/
     ```
5. **Source code.** The submitted files are bundled and minified by Vite, so AMO asks for the source. Upload
   a zip of the repository without `node_modules` and `dist`, and include these build instructions:
   `Node 22, npm ci, npm run build -w @lemma/extension → apps/extension/dist/firefox`. tesseract.js
   `worker.min.js` and the `tesseract-core-*.wasm.js` files are unmodified copies from npm
   (tesseract.js 5.1.1, tesseract.js-core 5.1.1). Say so in the reviewer notes.
6. **Listing:** name, summary (≤ 250 characters), description, category (Education or Other), support
   email/URL, privacy policy, and screenshots.
7. **Data collection.** The manifest declares `data_collection_permissions: { required: ["none"] }`, so
   Firefox shows "This extension doesn't collect data". In the AMO form, answer that no data is collected or
   transmitted.
8. **The Gecko ID** is `lemma@lemma.app` (in the manifest). Never change it after the first upload,
   because it identifies the add-on for updates.

### One-click "Add" from your website (Firefox)

- Easiest: link to the AMO listing. The user clicks "Add to Firefox", then "Add" on the permission prompt.
- Self-hosted: serve the **signed** `.xpi` over HTTPS with `Content-Type: application/x-xpinstall` and link to
  it (`<a href="/lemma-0.1.0.xpi">Add to Firefox</a>`). Firefox first shows "Firefox prevented this site
  from asking you to install software". The user clicks **Continue to Installation**, then **Add** on the
  permission prompt. Firefox installs only signed add-ons (release builds have no override), and the old
  `InstallTrigger` API has been removed, so a link is the only route.

## Safari (macOS and iOS App Store)

Safari extensions ship inside an app. Convert `dist/chrome` with `xcrun safari-web-extension-converter`,
sign with an Apple Developer Program team ($99/year), archive in Xcode, and submit through App Store Connect
with App Privacy set to "Data Not Collected". Exact commands and steps: [`safari/README.md`](safari/README.md).

---

## Pre-submission checklist

- [ ] `npm run build -w @lemma/extension` succeeds (it also runs the CSP and remote-code checks)
- [ ] `npx tsc -p apps/extension/tsconfig.json --noEmit` and `npm test -w @lemma/extension` are clean
- [ ] `npm run e2e -w @lemma/extension` passes (Chromium, unpacked build)
- [ ] Version bumped in `apps/extension/package.json`
- [ ] Privacy policy published and linked in every store
- [ ] Screenshots taken in light and dark mode
- [ ] Decide whether to bundle `vendor/eng.traineddata.gz` (+2.9 MB, offline OCR, no network request at all)
