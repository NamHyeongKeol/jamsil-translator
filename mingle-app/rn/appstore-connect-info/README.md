# App Store Connect Info Workspace

`mingle-app/rn/appstore-connect-info` is the local workspace for iOS App Store Connect assets and localized copy.

## Directory layout

- `generated/`: output from `scripts/ios-appstore-media.sh`
  - `final/iphone-69`
  - `final/ipad-13`
  - `preview`
- `upload/<locale>/`: files prepared for `scripts/ios-appstore-upload.sh`
- `appstore-connect-info.i18n.json`: single source of truth
  - `ios.submission.screenshots`: "iOS 앱 > 1.0.0 제출 준비 중" screenshot copy
  - `ios.submission.appStoreInfo`: version metadata (promo text, description, keywords, URLs)
  - `ios.generalInfo.appInfo`: app info metadata (title, subtitle)
- `RUNBOOK.appstore-preview-localization.md`: appstore-preview API localization workflow

## Default behavior

- `scripts/ios-appstore-media.sh` writes to `generated/` by default.
- `scripts/ios-appstore-upload.sh` reads from `upload/` by default.
- `scripts/devbox ios-appstore-sync-metadata` reads `appstore-connect-info.i18n.json` by default.

## Quick commands

```bash
scripts/ios-appstore-media.sh --no-build
scripts/ios-appstore-upload.sh --locale en-US
scripts/devbox ios-appstore-sync-metadata --dry-run
scripts/devbox ios-appstore-sync-metadata
pnpm dlx tsx scripts/ios-appstore-preview-clone-locale.ts --locale ja --target-project-name "Mingle 일본어"
```
