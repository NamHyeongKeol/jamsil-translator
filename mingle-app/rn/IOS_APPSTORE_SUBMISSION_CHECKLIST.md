# iOS App Store Submission Checklist (main baseline)

Date: 2026-02-25

## 1. Build Readiness (codebase)

- [x] RN deps sync (`pnpm --dir mingle-app/rn install`)
- [x] iOS pods sync (`pod install` or `bundle exec pod install`)
- [x] Release iOS build succeeded (`xcodebuild ... -workspace rnnative.xcworkspace -scheme rnnative -configuration Release -sdk iphoneos ... build`)
- [x] `Info.plist` cleanup: removed empty `NSLocationWhenInUseUsageDescription`

## 2. Must-do before upload

- [x] Decide release version/build number:
  - `MARKETING_VERSION` = `1.0.0`, `CURRENT_PROJECT_VERSION` = `1`
  - file: `mingle-app/rn/ios/rnnative.xcodeproj/project.pbxproj`
- [ ] Create App Store Connect app entry for bundle ID `com.minglelabs.mingle.rn` (if first upload)
- [ ] Prepare signing for App Store distribution (team: `3RFBMN8TKZ`)
  - checked: `CODE_SIGN_STYLE = Automatic`, `DEVELOPMENT_TEAM = 3RFBMN8TKZ`
  - pending: App Store Distribution certificate/profile selection in Xcode/Apple Developer
- [ ] Archive + validate + upload from Xcode Organizer (or `xcodebuild archive` + export flow)
  - attempted: `xcodebuild ... -archivePath /tmp/rnnative.xcarchive archive`
  - blocked in this environment: `xcodebuild: error: '.../rnnative.xcworkspace' is not a workspace file`
- [ ] Fill App Privacy / Data Collection answers in App Store Connect
- [ ] Fill Export Compliance (encryption) questionnaire
- [ ] Upload metadata:
  - app description, keywords, support/privacy URLs
  - age rating, categories
  - screenshots (required device sets)
- [ ] Submit TestFlight build and run smoke QA on real devices

## 3. Recommended pre-submit smoke checks

- [ ] First launch + WebView load success on production URL
- [ ] Microphone permission prompt and STT start/stop
- [ ] TTS playback (speaker + earphone/Bluetooth route)
- [ ] Background/lock-resume behavior (audio session continuity)
- [ ] Network error handling when WS/API unreachable

## 4. Archive command template (manual signing setup required)

```bash
xcodebuild \
  -workspace mingle-app/rn/ios/rnnative.xcworkspace \
  -scheme rnnative \
  -configuration Release \
  -sdk iphoneos \
  -archivePath /tmp/rnnative.xcarchive \
  archive
```

## 5. Execution Notes (2026-02-25)

- `pnpm --dir mingle-app/rn install` succeeded.
- `cd mingle-app/rn && bundle config set --local path 'vendor/bundle' && bundle install` succeeded.
- `cd mingle-app/rn/ios && HOME=/tmp/codex-home bundle exec pod install` succeeded.
- `xcodebuild -workspace ... -scheme rnnative -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO build` succeeded (`** BUILD SUCCEEDED **`).
- `Info.plist` verified: no `NSLocationWhenInUseUsageDescription` key.
