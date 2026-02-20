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

`pnpm test` runs both unit tests and a live integration test that:

1. Streams an audio fixture to local STT WebSocket server
2. Sends the finalized transcript to `/api/translate/finalize`

Useful commands:

- `pnpm test` (unit + live integration)
- `pnpm test:unit` (unit only, excludes live integration)
- `pnpm test:live` (live integration only)

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
MINGLE_TEST_EXPECTED_PHRASE="hello mingle"
```

Fixture scan behavior:

- 폴더 내 파일명은 자유입니다.
- `.wav`(PCM16/mono) 파일은 바로 처리합니다.
- `.m4a` 포함 일부 포맷은 ffmpeg(또는 macOS afconvert)로 변환 후 처리합니다.
- 변환/파싱 실패 파일은 경고만 출력하고 skip 후 다음 파일로 진행합니다.
- 유효한 fixture가 1개도 없으면 테스트는 실패합니다.

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
2. Fill in `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`.
3. In Google Cloud Console, add this callback URL:

```text
http://localhost:3000/api/auth/callback/google
```

If Google OAuth env vars are missing, the app automatically falls back to demo credential login.

## Database (Supabase, app schema)

This app is designed to share the same Postgres instance as `mingle-landing`,
but use a separate schema:

- `mingle-landing` -> `public`
- `mingle-app` -> `app`

Set `DATABASE_URL` with `?schema=app`:

```text
postgresql://USER:PASSWORD@HOST:6543/postgres?schema=app
```

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

- `RN_WEB_APP_BASE_URL` (fallback: `NEXT_PUBLIC_SITE_URL`)
- `RN_DEFAULT_WS_URL` (fallback: `NEXT_PUBLIC_WS_URL`)

루트 `pnpm rn:start|ios|android` 스크립트는 `.env.local`을 먼저 로드한 뒤 RN CLI를 실행합니다.

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
