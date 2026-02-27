This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Live STT/API Integration Test (included in `pnpm test`)

`pnpm test` runs both unit tests and live integration tests that:

1. Streams an audio fixture to local STT WebSocket server
2. Sends the finalized transcript to `/api/translate/finalize` (or `/api/ios/v1.0.0/translate/finalize`)

Useful commands:

- `pnpm test` (unit + live integration)
- `pnpm test:unit` (unit only, excludes live integration)
- `pnpm test:live` (all live `.live.test.ts` only)

Default local endpoints:

- STT WS: `ws://127.0.0.1:3001`
- API: `http://127.0.0.1:3000`

Default audio fixture path:

- `test-fixtures/audio/fixtures/`
- `test-fixtures/audio/local/` (git ignored local fixtures)

You can override paths/endpoints with env vars:

```bash
MINGLE_TEST_AUDIO_FIXTURE=/absolute/path/to/file.wav
MINGLE_TEST_AUDIO_FIXTURE_DIR=/absolute/path/to/fixtures-dir
MINGLE_TEST_WS_URL=ws://127.0.0.1:3001
MINGLE_TEST_API_BASE_URL=http://127.0.0.1:3000
MINGLE_TEST_API_NAMESPACE=
MINGLE_TEST_EXPECTED_PHRASE="hello mingle"
MINGLE_TEST_TARGET_LANGUAGES=ko,en
MINGLE_TEST_TTS_LANGUAGE=ko
MINGLE_TEST_TTS_OUTPUT_DIR=/absolute/path/to/tts-output
```

## API Namespace (Release Routing)

클라이언트는 런타임 분기 없이 `NEXT_PUBLIC_API_NAMESPACE`로 API 경로를 결정합니다.

- 기본값(legacy): 빈 값(`''`) -> `/api/{기존경로}`
- iOS versioned: `ios/v1.0.0` -> `/api/ios/v1.0.0/{기존경로}`

Release build commands:

```bash
pnpm build:release:web
pnpm build:release:ios
pnpm build:release:android
```

URL override (optional):

- 브라우저 URL 쿼리 `apiNamespace`(또는 `apiNs`)는 allow-list 값만 반영됩니다.
- 허용값: `''`, `ios/v1.0.0`
- 예: `https://your-app/ko?apiNamespace=ios/v1.0.0`
- 허용되지 않은 값은 무시되고 env/default를 사용합니다.

### iOS Client Version Policy

- 앱 시작 시 `POST /api/ios/v1.0.0/client/version-policy`를 호출합니다.
- 요청: `clientVersion`(`x.y.z`), `clientBuild`
- 응답 `action`:
  - `force_update`: 강제 업데이트 화면
  - `recommend_update`: 권장 업데이트 알림
  - `none`: 표시 없음

Contract test commands:

```bash
# API namespace allow-list + route wiring
pnpm test:unit -- src/lib/api-contract.test.ts src/app/api/namespace-routing.contract.test.ts src/lib/rn-api-namespace.test.ts
```

Fixture scan behavior:

- 폴더 내 파일명은 자유입니다.
- `.wav`(PCM16/mono) 파일은 바로 처리합니다.
- `.m4a` 포함 일부 포맷은 ffmpeg(또는 macOS afconvert)로 변환 후 처리합니다.
- 변환/파싱 실패 파일은 경고만 출력하고 skip 후 다음 파일로 진행합니다.
- fixture 후보 파일이 없으면 fixture 의존 live 스위트는 자동 skip 됩니다.
- 파일이 있는데 모두 invalid면 테스트는 실패합니다.
- 기본 오디오 전송은 실시간 속도(`40ms chunk / 40ms delay`)로 동작합니다.

Translation/TTS behavior:

- source가 `en`이면 target은 기본 `ko`
- source가 `ko`면 target은 기본 `en`
- 그 외 source는 기본 target `ko,en`
- 테스트 stdout에 Soniox 원문과 finalize 번역 결과를 출력합니다.
- finalize 응답에 TTS가 오면 음성 파일을 `test-fixtures/audio/local/tts-output/`에 저장합니다(로컬 전용, git ignore).

### Live E2E suites

Always-on suites:

- `src/integration/live/stt-finalize.live.test.ts`
- `src/integration/live/e2e.stop-chain.live.test.ts`
- `src/integration/live/e2e.stop-ack-fallback.live.test.ts`
- `src/integration/live/e2e.finalize-fallback.live.test.ts`
- `src/integration/live/e2e.language-matrix.live.test.ts`
- `src/integration/live/e2e.soniox-endpoint-compat.live.test.ts`
- `src/integration/live/e2e.soniox-segmentation.live.test.ts`
- `src/integration/live/e2e.tts-artifact.live.test.ts`

Device-dependent optional suites (env flag required):

- `MINGLE_TEST_IOS_HEALTHCHECK=1` -> `e2e.ios-launch-healthcheck.live.test.ts`
- `MINGLE_TEST_IOS_TTS_EVENT_E2E=1` -> `e2e.ios-tts-event-order.live.test.ts`

Finalize fault-injection E2E notes:

- live 테스트는 finalize fault mode 요청 시 `x-mingle-live-test: 1` 헤더를 붙입니다.
- API 서버는 non-production 환경에서만 `provider_empty/target_miss/provider_error` 강제 모드를 허용합니다.

iOS launch healthcheck notes:

- 스크립트: `scripts/e2e-ios-launch-healthcheck.sh`
- 필수 env: `MINGLE_TEST_IOS_UDID`
- 선택 env: `MINGLE_TEST_IOS_BUNDLE_ID`, `MINGLE_TEST_IOS_INSTALL=1`, `MINGLE_TEST_IOS_APP_PATH`

Fixture requirements:

- WAV (RIFF/WAVE)
- PCM 16-bit
- mono (1 channel)

Audio fixture git policy:

- 팀 공통 재현용 짧은 샘플 1개는 `test-fixtures/audio/fixtures/`에 커밋 권장
- 개인/민감 음성은 `test-fixtures/audio/local/`에 두고 git ignore 처리

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Authentication Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in `AUTH_SECRET`.
3. Configure at least one OAuth provider:

Google OAuth:

- env: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- callback URL:

```text
http://localhost:3000/api/auth/callback/google
```

Apple OAuth:

- env required:
  - `AUTH_APPLE_ID`
  - either `AUTH_APPLE_SECRET` directly
  - or (`AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, `AUTH_APPLE_PRIVATE_KEY`)
- callback URL:

```text
http://localhost:3000/api/auth/callback/apple
```

Apple OAuth token issuance references:

- Service ID / client id: <https://developer.apple.com/account/resources/identifiers/list/serviceId>
- Sign in with Apple key (`.p8`) / key id: <https://developer.apple.com/account/resources/authkeys/list>
- Team ID: <https://developer.apple.com/account>
- Token API spec (client secret JWT): <https://developer.apple.com/documentation/signinwithapplerestapi/generate_and_validate_tokens>

Generate `AUTH_APPLE_SECRET` from `.p8` key env values:

```bash
pnpm auth:apple:secret
```

If both Apple and Google OAuth env vars are missing, the app automatically falls back to demo credential login.

## Database (Supabase, app schema)

This app is designed to share the same Postgres instance as `mingle-landing`,
but use a separate schema:

- `mingle-landing` -> `public`
- `mingle-app` -> `app`

Set `DATABASE_URL` with `?schema=app`:

```text
postgresql://USER:PASSWORD@HOST:6543/postgres?schema=app
```

If `DATABASE_URL` misses `schema`, app runtime automatically appends `schema=app`.
An explicit schema value (for example `schema=public`) is respected as-is.

Create Prisma artifacts:

```bash
pnpm db:generate
pnpm db:migrate:create
```

Reset local `app` schema via `psql` (drop + recreate + apply migrations):

```bash
pnpm db:reset:local:psql
```

`db:*` Prisma scripts load environment variables from `.env.local`.

Production build runs `prisma generate` first:

```bash
pnpm build
```

If you apply SQL manually to remote, use:

- `prisma/migrations/20260216173000_init_app_schema/migration.sql`

## React Native (mingle-app/rn)

`mingle-app` now also includes a dedicated RN workspace at `rn/`.

```bash
pnpm rn:install
pnpm rn:pods
pnpm rn:start
pnpm rn:ios
```

RN 앱 URL은 하드코딩하지 않고 환경변수로만 읽습니다.

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_API_NAMESPACE` (iOS 필수: `ios/v1.0.0`)
- iOS에서 `NEXT_PUBLIC_API_NAMESPACE`가 `ios/v1.0.0`과 불일치하면 WebView를 로드하지 않고 오류를 표시합니다.
- `RN_CLIENT_VERSION` (optional, fallback: `CFBundleShortVersionString`)
- `RN_CLIENT_BUILD` (optional, fallback: `CFBundleVersion`)

서버 환경변수(optional):

- `IOS_CLIENT_MIN_SUPPORTED_VERSION` (default: `1.0.0`)
- `IOS_CLIENT_RECOMMENDED_BELOW_VERSION`
- `IOS_CLIENT_LATEST_VERSION`
- `IOS_APPSTORE_URL`

루트 `pnpm rn:start|ios|android` 스크립트는 `.env.local`을 먼저 로드한 뒤 RN CLI를 실행합니다.
`pnpm rn:ios`는 실행 전에 `NEXT_PUBLIC_API_NAMESPACE=ios/v1.0.0` 검증을 강제합니다.

- iOS native STT bridge lives in:
  - `rn/ios/rnnative/NativeSTTModule.swift`
  - `rn/ios/rnnative/NativeSTTModuleBridge.m`
- RN screen for basic STT verification:
  - `rn/App.tsx`

## Seed Data

```bash
pnpm seed:check
pnpm seed:populate
```

- Source file: `data/seed/mingle-seed.json`
- Export target: `public/seed/mingle-seed.json`

## Crawling Pipeline

```bash
pnpm crawl:instagram
```

- Input sample: `data/crawl/instagram-input.sample.json`
- Normalized output: `data/crawl/instagram-normalized.json`
