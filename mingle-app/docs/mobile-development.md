# Mingle Mobile Development Notes

## Scope
- Keep web app and mobile app in the same repository (`mingle-app`).
- Use a dedicated React Native workspace for native audio/STT behavior.

## Implemented
- `rn/`
  - Dedicated React Native app workspace.
- `rn/ios/mingle/NativeSTTModule.swift`
  - AVAudioEngine + WebSocket based iOS native STT transport.
- `rn/ios/mingle/NativeSTTModuleBridge.m`
  - React Native bridge export for `start/stop` + events.
- `rn/App.tsx`
  - Basic STT start/stop verification screen.

## Why this structure
- Keeps web frontend and native audio responsibilities clearly separated.
- Avoids WebView runtime limits for background/lock-screen audio behavior.
- Preserves existing Next.js web stack while enabling native-only audio path.
