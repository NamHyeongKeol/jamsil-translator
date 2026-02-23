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
# Vault를 쓰면 (선택)
# scripts/devbox bootstrap --vault-app-path secret/mingle-app/dev --vault-stt-path secret/mingle-stt/dev
# 또는 첫 실행부터 한 번에
# scripts/devbox up --profile device --vault-app-path secret/mingle-app/dev --vault-stt-path secret/mingle-stt/dev
scripts/devbox up --profile local
scripts/devbox up --profile device
# 연결된 테스트폰이 있으면 모바일 빌드/설치까지
# scripts/devbox up --profile device --with-mobile-install
# iOS만 설치하려면
# scripts/devbox up --profile device --with-ios-install
# 전체 로그를 파일로 남기려면
# scripts/devbox --log-file auto up --profile device --with-ios-install
scripts/devbox status
```

- 상세 가이드: `docs/worktree-devbox.md`
- `scripts/devbox bootstrap`은 main 워크트리의 `mingle-app/.env.local`,
  `mingle-stt/.env.local`을 시드하고 필요한 의존성을 자동 설치합니다.
  또한 `@prisma/client` 생성물이 없으면 `db:generate`를 자동 실행합니다.
  RN 워크스페이스 의존성과 iOS Pods도 자동 점검하며,
  `Podfile.lock`/`Pods/Manifest.lock` 불일치 시 `pod install`로 자동 동기화합니다.
- Vault 사용 시 `--vault-app-path`, `--vault-stt-path`로 비관리 env 키를 동기화할 수 있습니다.
  한 번 지정하면 `.devbox.env`에 저장되어 이후 `bootstrap/up`에서 자동 재사용됩니다.
- `--profile device`는 ngrok(`devbox_web`/`devbox_stt`)까지 포함해 실기기 테스트 URL을 자동 반영합니다.
- 워크트리마다 ngrok inspector 포트를 분리(`DEVBOX_NGROK_API_PORT`)해 동시 실행 충돌을 줄였습니다.
- `--profile device`는 현재 워크트리 포트와 일치하는 `https/wss` 터널만 허용합니다.
- `scripts/devbox up`은 `.devbox.env`가 없으면 `init`을 자동 실행합니다.
- `scripts/devbox up --profile device`는 가능한 경우 ngrok을 별도 터미널 탭/패널로 분리 실행합니다
  (불가 환경에서는 기존 인라인 실행으로 자동 폴백).
- `scripts/devbox --log-file PATH up ...`를 사용하면 devbox 전체 stdout/stderr를 파일로 저장합니다.
  `PATH`가 상대경로면 저장소 루트 기준이며, `auto`를 주면 `.devbox-logs/`에 타임스탬프 파일을 생성합니다.
  ngrok이 별도 터미널에서 실행되면 ngrok 로그는 해당 터미널에서 확인합니다.
  `.devbox-logs/` 폴더는 gitignore 처리되어 로그가 커밋되지 않습니다.
- `scripts/devbox mobile --platform ios|android|all`로 기기 연결 시 RN 앱 빌드/설치 자동화를 수행합니다.
- `scripts/devbox up --profile device --with-mobile-install`으로 서버 준비 + 모바일 설치를 한 번에 실행할 수 있습니다.

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
