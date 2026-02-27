# iOS App Store Submission Checklist (main baseline)

Date: 2026-02-21

## 1. Build Readiness (codebase)

- [x] RN deps sync (`pnpm --dir mingle-app/rn install`)
- [x] iOS pods sync (`pod install` or `bundle exec pod install`)
- [x] Release iOS build succeeded (`xcodebuild ... -workspace mingle.xcworkspace -scheme mingle -configuration Release -sdk iphoneos ... build`)
- [x] `Info.plist` cleanup: removed empty `NSLocationWhenInUseUsageDescription`

## 2. Must-do before upload

- [ ] Decide release version/build number:
  - `MARKETING_VERSION` (`1.0`) and `CURRENT_PROJECT_VERSION` (`1`) in `mingle-app/rn/ios/mingle.xcodeproj/project.pbxproj`
- [ ] Create App Store Connect app entry for bundle ID `com.minglelabs.mingle.rn` (if first upload)
- [ ] Prepare signing for App Store distribution (team: `3RFBMN8TKZ`)
- [ ] Archive + validate + upload from Xcode Organizer (or `xcodebuild archive` + export flow)
- [ ] Fill App Privacy / Data Collection answers in App Store Connect
- [ ] Fill Export Compliance (encryption) questionnaire
- [ ] Upload metadata:
  - app description, keywords, support/privacy URLs
  - suggested legal URLs (prod):
    - `https://app.minglelabs.xyz/legal/privacy-policy.html`
    - `https://app.minglelabs.xyz/legal/terms-of-use.html`
  - locale-specific legal docs (15 locales):
    - `https://app.minglelabs.xyz/legal/` (language index)
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
  -workspace mingle-app/rn/ios/mingle.xcworkspace \
  -scheme mingle \
  -configuration Release \
  -sdk iphoneos \
  -archivePath /tmp/mingle.xcarchive \
  archive
```
