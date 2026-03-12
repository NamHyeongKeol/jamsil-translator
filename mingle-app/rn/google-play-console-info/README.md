# Google Play Console Info Workspace

`mingle-app/rn/google-play-console-info` is the local workspace for Google Play Console metadata and localized copy.

## Directory layout

- `upload/<locale>/`: temporary Play asset workspace, currently mirrored from iOS upload assets
- `google-play-console-info.i18n.json`: prepared source file for Play Console metadata
  - `googlePlay.release.screenshots`: Play listing screenshot copy
  - `googlePlay.storeListing`: localized title, short description, promotional text, full description, keywords, and URLs

## Default behavior

- No scripts read `google-play-console-info.i18n.json` yet; it is a prepared source file for manual Play Console entry.
- `upload/` is currently a direct copy of `rn/appstore-connect-info/upload/`.
