# Google Play Console Info Workspace

`mingle-app/rn/google-play-console-info` is the local workspace for Google Play Console metadata and localized copy.

## Directory layout

- `upload/<locale>/`: temporary Play asset workspace, currently mirrored from iOS upload assets
- `assets/`: Play-specific shared graphics
  - `icon-512.png`: Play hi-res icon used by the upload sync script
- `google-play-console-info.i18n.json`: prepared source file for Play Console metadata
  - `googlePlay.release.screenshots`: Play listing screenshot copy
  - `googlePlay.appDetails`: package name, default language, and Play contact details
  - `googlePlay.assets`: relative paths for Play listing graphics
  - `googlePlay.storeListing`: localized title, short description, promotional text, full description, keywords, and URLs
  - `googlePlay.manualOnly`: console-only items that must still be filled manually

## Default behavior

- `upload/` is currently a direct copy of `rn/appstore-connect-info/upload/`.
- `scripts/google-play-console-sync.mjs` reads `google-play-console-info.i18n.json` and uploads Play app details, store listing text, icon, and phone screenshots from this workspace.

## Quick commands

```bash
scripts/google-play-console-sync.mjs --dry-run
scripts/google-play-console-sync.mjs --service-account-json /path/to/service-account.json --validate-only
scripts/google-play-console-sync.mjs --service-account-json /path/to/service-account.json
```

## Prerequisites

- The Play app entry must already exist for the configured package name.
- A Google service account must be linked to Play Console with Android Publisher access.
- Some Play Console sections remain manual-only even after API sync:
  - privacy policy
  - app category / app type
  - data safety
  - content rating
  - target audience
  - ads declaration
  - account deletion
