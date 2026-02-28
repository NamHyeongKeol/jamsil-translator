# App Store Media Workspace

`mingle-app/rn/appstore-media` is the local workspace for iOS App Store screenshots/previews.

## Directory layout

- `generated/`: output from `scripts/ios-appstore-media.sh`
  - `final/iphone-69`
  - `final/ipad-13`
  - `preview`
- `upload/<locale>/`: files prepared for `scripts/ios-appstore-upload.sh`
- `copy/`: localized screenshot text source
  - `screenshot-copy.i18n.md` (human-readable, 7 shots + subtitle)
  - `screenshot-copy.i18n.json` (automation-friendly, 7 shots + subtitle)

## Default behavior

- `scripts/ios-appstore-media.sh` now writes to `generated/` by default.
- `scripts/ios-appstore-upload.sh` now reads from `upload/` by default.

## Quick commands

```bash
scripts/ios-appstore-media.sh --no-build
scripts/ios-appstore-upload.sh --locale en-US
```
