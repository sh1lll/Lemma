# Lemma for iOS and Android

`apps/mobile` wraps the production web build (`apps/web/dist`) in native iOS and Android shells with
[Capacitor](https://capacitorjs.com) 8.5.3 (`@capacitor/core`, `cli`, `ios`, `android`, pinned exactly).

- **App id:** `app.lemma.mobile` · **Name:** Lemma
- **Offline:** the whole web build is copied into the app bundle (`www/` → `ios/App/App/public`,
  `android/app/src/main/assets/public`). There is no `server.url`, so the app never loads code from the network.
  Only features that are online by nature (AI providers, exchange rates, the optional sync server) use the network.
- **Safe areas:** the web app already uses `viewport-fit=cover` and `env(safe-area-inset-*)`, so the WebView runs
  edge to edge (`ios.contentInset: "never"`) and the page pads itself around the Dynamic Island and home indicator.
- **Status bar:** `UIStatusBarStyleDefault`, which follows light/dark mode (dark text on the light theme, light text
  on the dark theme). See `screenshots/`.
- **Microphone:** `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in `Info.plist`;
  `RECORD_AUDIO` in `AndroidManifest.xml`.

Screenshots from the iOS Simulator (iPhone 17, iOS 26.5): `screenshots/ios-launch.png`,
`screenshots/ios-calculation.png` (`12*(3+4)` → 84) and `screenshots/ios-dark.png`.

## Layout

```
apps/mobile/
  capacitor.config.json   app id, name, webDir = www
  scripts/copy-web.mjs    copies apps/web/dist → www (gitignored)
  ios/                    Xcode project (Swift Package Manager, no CocoaPods)
  android/                Gradle project
```

## Build the web app and copy it in

Every native build starts from a fresh web build:

```sh
npm run build -w @lemma/web          # → apps/web/dist
npm run sync -w @lemma/mobile        # copy dist → www, then `cap sync` (ios + android)
# or one platform: npm run sync:ios -w @lemma/mobile / npm run sync:android -w @lemma/mobile
```

`cap sync` copies `www` into both native projects and writes the native config. Run it after every web change.

## iOS

Prerequisites: macOS with Xcode 26 (or newer) and an iOS Simulator runtime. No CocoaPods: Capacitor 8 uses Swift
Package Manager, and Xcode downloads `capacitor-swift-pm` 8.5.3 (prebuilt `Capacitor.xcframework` /
`Cordova.xcframework` from GitHub releases) the first time you build. That one download needs the network.

Open in Xcode:

```sh
npm run open:ios -w @lemma/mobile    # opens ios/App/App.xcodeproj
```

Build and run in the Simulator from the command line (no signing needed):

```sh
cd apps/mobile/ios/App
xcrun simctl list devices available                       # pick an iPhone
xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath build/dd CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot "iPhone 17"; open -a Simulator
xcrun simctl install "iPhone 17" build/dd/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch "iPhone 17" app.lemma.mobile
xcrun simctl io booted screenshot lemma.png
```

Debugging: in Debug builds the WebView is inspectable from Safari → Develop → Simulator → Lemma.

### Voice on iOS

The app uses the browser's own speech and microphone APIs inside `WKWebView`; no native plugin is added.
iOS shows the system microphone prompt (with the text from `Info.plist`) the first time the mic is used.
`getUserMedia` works in `WKWebView` on iOS 14.3+, so on-device Whisper transcription works. Web Speech
(`SpeechRecognition`) availability inside `WKWebView` depends on the iOS version; when it isn't available the app
falls back the same way it does in any browser without it. Test on a real device: the Simulator has no real
microphone path for speech recognition.

## Android

There is no Android SDK on the machine this was generated on, so the Android project has been generated and synced
but **not built**. To build it:

1. Install [Android Studio](https://developer.android.com/studio) (it bundles JDK 21). In *SDK Manager* install
   Android SDK Platform 36, Build-Tools 36, Platform-Tools and an emulator system image (e.g. API 36, arm64 on Apple
   silicon).
2. Point the tools at the SDK and JDK:
   ```sh
   export ANDROID_HOME="$HOME/Library/Android/sdk"          # Linux: ~/Android/Sdk
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
   ```
3. Sync and build a debug APK:
   ```sh
   npm run build -w @lemma/web
   npm run sync:android -w @lemma/mobile
   cd apps/mobile/android
   ./gradlew assembleDebug                 # → app/build/outputs/apk/debug/app-debug.apk
   ```
4. Run it on an emulator or a USB device with debugging enabled:
   ```sh
   emulator -list-avds && emulator -avd <name> &
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   adb shell am start -n app.lemma.mobile/.MainActivity
   ```
   Or `npm run open:android -w @lemma/mobile` and press Run in Android Studio.

Debugging: `chrome://inspect` in desktop Chrome shows the app's WebView.

SDK levels (from `android/variables.gradle`): min 24, compile 36, target 36.

## Icons and launch screen

- iOS: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` is a 1024×1024 opaque PNG rendered from
  `apps/web/public/icon.svg` (square, no rounded corners: iOS applies its own mask). The launch screen is Capacitor's
  default `Splash` image set; replace `Assets.xcassets/Splash.imageset` with branded artwork before release.
- Android: still Capacitor's default launcher icons and splash. Replace them with Android Studio →
  *New → Image Asset* (adaptive icon from `icon.svg`) before release.

## Releasing to the App Store (needs your Apple Developer account)

1. Join the Apple Developer Program (paid, yearly). In *Certificates, Identifiers & Profiles* register the App ID
   `app.lemma.mobile`. No extra capabilities are needed.
2. In App Store Connect create the app (name Lemma, bundle id `app.lemma.mobile`, a SKU, primary language).
3. In Xcode: target *App* → *Signing & Capabilities* → choose your Team, keep *Automatically manage signing*.
   Set *Version* (`MARKETING_VERSION`) and *Build* (`CURRENT_PROJECT_VERSION`); increase Build on every upload.
4. Build the web app and `npm run sync:ios -w @lemma/mobile`, then in Xcode choose *Any iOS Device (arm64)* →
   *Product → Archive* → *Distribute App → App Store Connect → Upload*.
5. **Export compliance:** `Info.plist` sets `ITSAppUsesNonExemptEncryption = NO`. The app's only encryption is
   AES-GCM through the system's Web Crypto, used to protect the user's own sync/backup data, which Apple's export rules
   treat as exempt. Confirm this matches your situation before submitting; if not, remove the key and answer the
   questions in App Store Connect.
6. **App Privacy (nutrition labels):** Lemma has no accounts, analytics or ads, and stores data on the device.
   Declare "Data Not Collected" unless you ship a configuration that sends data somewhere you control. Note in the
   review/privacy text that, only when the user turns them on, questions go to the AI provider the user configures,
   and encrypted sync blobs go to a sync server the user chooses (the server cannot read them). Provide a privacy
   policy URL.
7. TestFlight: after processing, add internal testers, then external testers (needs a short beta review).
8. Submit for review with screenshots (6.9" and 13" iPad sizes are required), a description, keywords, support URL,
   and review notes, e.g. "No login. Type or say a calculation such as 12*(3+4). Microphone is used only after tapping
   the mic button."

## Releasing to Google Play (needs your Google Play Console account)

1. Create a Google Play developer account (one-time fee; identity verification required).
2. Create a release keystore once and keep it (and its passwords) safe and out of the repo:
   ```sh
   keytool -genkeypair -v -keystore lemma-release.jks -alias lemma -keyalg RSA -keysize 4096 -validity 10000
   ```
   Add a `signingConfigs.release` to `android/app/build.gradle` that reads the path and passwords from
   `~/.gradle/gradle.properties` or environment variables (never commit them). Enroll in *Play App Signing* so Google
   holds the app-signing key and your keystore is only the upload key.
3. Set `versionCode` (increase every upload) and `versionName` in `android/app/build.gradle`.
4. Build the Android App Bundle:
   ```sh
   npm run build -w @lemma/web && npm run sync:android -w @lemma/mobile
   cd apps/mobile/android && ./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
   ```
5. In Play Console create the app, fill in *App content*: privacy policy, ads (none), **Data safety** (no data
   collected or shared by the developer; optional user-initiated transfers to the AI provider / sync server the user
   configures, encrypted in transit; sync data end-to-end encrypted), content rating questionnaire, target audience.
   Explain the `RECORD_AUDIO` permission (voice input; audio not stored).
6. Upload the `.aab` to an internal testing track first, then closed/open testing, then production. New personal
   developer accounts must run a closed test with testers for a period before production access; check the current
   Play Console requirements.
7. Keep `targetSdkVersion` at the level Google Play currently requires (36 today).

## Known limits

- Android has not been compiled here (no SDK); the project is generated and synced only.
- The service worker in the web build is not used inside the native apps (assets are already local).
- No native plugins (status bar, haptics, native speech) are installed; everything runs through the web APIs.
- `npm audit` reports a moderate advisory in `uuid` pulled in by `@capacitor/cli` → `xcode`. It is a build-time CLI
  dependency and is not shipped in the app.
