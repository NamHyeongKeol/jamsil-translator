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
