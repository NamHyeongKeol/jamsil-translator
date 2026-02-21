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

## Worktree Local Test Automation (mingle-app + mingle-stt)

브랜치/워크트리별로 로컬 테스트 환경을 자동 분리하려면:

```bash
scripts/devbox init
scripts/devbox bootstrap
scripts/devbox up --profile local
scripts/devbox up --profile device
scripts/devbox status
```

- 상세 가이드: `docs/worktree-devbox.md`
- `scripts/devbox bootstrap`은 main 워크트리의 `mingle-app/.env.local`,
  `mingle-stt/.env.local`을 시드하고 필요한 의존성을 자동 설치합니다.
- `--profile device`는 ngrok(`web`/`stt`)까지 포함해 실기기 테스트 URL을 자동 반영합니다.
- `--profile device`는 현재 워크트리 포트와 일치하는 `https/wss` 터널만 허용합니다.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## License

This repository is licensed under the GNU General Public License v3.0 (GPL-3.0-only). See `LICENSE`.
