# Lemma for Safari

Safari runs the same Manifest V3 extension, but only inside a native app container (a macOS and/or iOS
app with a Safari Web Extension target). Apple's converter makes that Xcode project from `dist/chrome`.
Nothing in `src/` is Safari-specific.

## 1. Build the web extension

```bash
npm run build -w @lemma/extension      # → apps/extension/dist/chrome
```

## 2. Convert to an Xcode project

```bash
cd apps/extension
xcrun safari-web-extension-converter dist/chrome \
  --project-location dist/safari \
  --app-name Lemma \
  --bundle-identifier app.lemma.extension \
  --swift --copy-resources --no-open --no-prompt --force
# or: npm run safari -w @lemma/extension
```

- `--copy-resources` copies the built extension into the project, so the Xcode project stands on its own.
  To pick up a new build, run the build and this command again (or use
  `--rebuild-project dist/safari/Lemma/Lemma.xcodeproj`).
- Add `--macos-only` or `--ios-only` to limit platforms. The default makes both a macOS and an iOS app.
- The converter warns about manifest keys Safari ignores. The run here reported exactly these:
  - `side_panel` and the `sidePanel` permission: Safari has no side panel. The popup's "Open side panel"
    button opens the same page in a tab, and screen captures open the review page in a tab.
  - `open_in_tab` (options page): Safari shows the options page its own way.

Requires Xcode 12 or later. This repository was converted with Xcode 26.6 on macOS 26.5.

## 3. Run it locally (no signing needed)

1. Open `dist/safari/Lemma/Lemma.xcodeproj` in Xcode.
2. Pick the **Lemma (macOS)** scheme and **My Mac**, then Product → Run. This builds the container app and
   registers the extension.
3. In Safari: Settings → Advanced → enable "Show features for web developers". Then Develop → "Allow
   Unsigned Extensions" (asked again each time Safari restarts).
4. Safari → Settings → Extensions → enable Lemma. Then allow it on websites as prompted. Safari asks per
   site, which matches the extension's activeTab-only design.

## 4. Ship it through the App Store

Safari extensions are distributed only as part of an app in the Mac App Store or iOS App Store (or, for
macOS only, a Developer ID–signed app outside the store).

1. **Apple Developer Program** membership ($99/year) at developer.apple.com.
2. In Xcode, for **both** targets (the app and the "Lemma Extension"), set the Team under
   Signing & Capabilities. Keep automatic signing on. Bundle IDs: `app.lemma.extension` and
   `app.lemma.extension.Extension` (the converter sets these).
3. Set the version (CFBundleShortVersionString) to match `manifest.json` `version`, and bump the build number for
   every upload.
4. App icon: replace the placeholder in `Assets.xcassets/AppIcon` (render it from `apps/web/public/icon.svg`
   at 1024 × 1024).
5. In App Store Connect, create a new app (macOS and/or iOS) with that bundle ID. Fill in the name,
   subtitle, category (Education or Utilities), description, keywords, support URL, privacy policy URL, and
   screenshots (Safari with the popup, the bubble on a page, and the side panel–style review page).
6. **App Privacy**: "Data Not Collected". This matches the code: nothing is sent off the device. The one
   network request is the optional one-time download of OCR language data from jsDelivr when it isn't bundled,
   and that request contains no user data.
7. Product → Archive, then Distribute App → App Store Connect → Upload. Select the build in App Store Connect,
   then submit for review.
8. In the review notes, explain how to try it: select `2x + 3 = 11` on any page → right-click → Lemma →
   Calculate. On iOS, the popup and Calculate work, but context menus and keyboard commands don't exist there.

## What works in Safari (not tested here)

These are expectations from Safari's WebExtension support, not results from this repository. Only the
conversion was run here, without building or signing.

| Feature | macOS Safari | iOS Safari |
|---|---|---|
| Popup calculator | yes | yes |
| Selection context menu + bubble | yes | no context menus. Use the popup |
| Alt+Shift+S command | yes (Safari may ask you to assign it) | no |
| Side panel | no side panel. The panel page opens in a tab | same |
| Screen capture + OCR | `tabs.captureVisibleTab` and WebAssembly are supported. Check that OCR runs before release | same |
