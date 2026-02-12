# Mingle Mobile Development Notes

## Scope
- Build the app as a single codebase that runs on web and native shells.
- Keep core UI/logic in Next.js and expose platform checks through one runtime module.

## Implemented
- `src/lib/mobile-runtime.ts`
  - Detects `web | ios | android`.
  - Detects native bridge availability (`window.Capacitor`).
  - Exposes readiness flags for safe-area/background audio/push behavior.
- `src/app/page.tsx`
  - Added `Mobile Runtime` status card in `My` tab for quick verification.
- `src/app/globals.css`
  - Added `.mobile-safe-shell` class for safe-area insets.

## Why this structure
- Keeps mobile-specific conditions centralized.
- Avoids scattering user-agent checks across components.
- Makes later Capacitor migration mechanical instead of a full UI rewrite.
