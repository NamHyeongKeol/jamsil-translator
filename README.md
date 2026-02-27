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
# .env.local 값을 Vault에 업로드하려면 (선택)
# scripts/devbox bootstrap --vault-push
scripts/devbox up --profile local
scripts/devbox up --profile device
scripts/devbox up --profile device --device-app-env dev
scripts/devbox up --profile device --device-app-env prod --with-ios-install --with-ios-clean-install --ios-configuration Release
# 연결된 테스트폰이 있으면 모바일 빌드/설치까지
# scripts/devbox up --profile device --with-mobile-install
# iOS만 설치하려면
# scripts/devbox up --profile device --with-ios-install
# iOS 네이티브만 설치하려면
# scripts/devbox up --profile device --with-ios-install --ios-runtime native
# mingle-ios만 빌드하려면(설치 없음)
# scripts/devbox ios-native-build --ios-configuration Debug
# RN iOS App Store/TestFlight용 ipa 아카이브/익스포트
# scripts/devbox ios-rn-ipa --device-app-env prod
# scripts/devbox ios-rn-ipa-prod
# 또는 RN + 네이티브를 같이 설치
# scripts/devbox mobile --platform ios --ios-runtime both
# 전체 로그를 파일로 남기려면
# scripts/devbox --log-file auto up --profile device --with-ios-install
# 테스트
scripts/devbox test --target app
# scripts/devbox test --target ios-native
# scripts/devbox test --target all
scripts/devbox status
```

- 상세 가이드: `docs/worktree-devbox.md`
- `scripts/devbox bootstrap`은 `.env.local`을 수정하지 않는 읽기 전용 동작이며,
  의존성 설치와 검증만 수행합니다.
  (`@prisma/client` 생성물이 없으면 `db:generate` 자동 실행, RN/Pods 점검 포함)
- Vault 사용 시 `--vault-app-path`, `--vault-stt-path`를 저장해 이후 재사용할 수 있습니다.
- `scripts/devbox bootstrap --vault-push`를 사용하면
  `mingle-app/.env.local`, `mingle-stt/.env.local`의 비관리 키를 Vault로 업로드할 수 있습니다.
- Vault CLI 환경(`VAULT_ADDR`, `VAULT_NAMESPACE`)은 셸(`.zshrc`) 또는
  `mingle-app/.env.local`/`mingle-stt/.env.local`에 두면 devbox가 자동 참조합니다.
- `scripts/devbox gateway --mode dev|run`으로 `/Users/nam/openclaw`의 gateway 실행을 devbox 명령으로 통합할 수 있습니다.
- devbox 기본 동작은 `.env.local`을 건드리지 않고(stateless) ngrok/xcconfig 기준으로 동작합니다.
- `scripts/devbox up`/`init`/`mobile`/`bootstrap`은 `.env.local` 자동 동기화를 하지 않습니다.
- `scripts/devbox up`은 저장된 Vault 경로가 있으면 비관리 키(API key 등)를
  서버 프로세스 환경변수로 런타임 주입합니다(파일 미기록).
- `--profile device`는 ngrok(`devbox_web`/`devbox_stt`)까지 포함해 실기기 테스트 URL을 자동 반영합니다.
- `--profile device`에서 `--device-app-env dev|prod`를 주면 모바일 앱 빌드 URL을
  `secret/mingle-app/dev` 또는 `secret/mingle-app/prod`에서 읽어 주입합니다
  (RN + `mingle-ios` 네이티브 URL 키 모두 지원).
  `--device-app-env prod`에서는 `up` 실행 시 ngrok/로컬 서버 기동을 생략합니다.
- 워크트리마다 ngrok inspector 포트를 분리(`DEVBOX_NGROK_API_PORT`)해 동시 실행 충돌을 줄였습니다.
- `--profile device`는 현재 워크트리 포트와 일치하는 `https/wss` 터널만 허용합니다.
- `scripts/devbox up`은 `.devbox.env`가 없으면 `init`을 자동 실행합니다.
- `scripts/devbox up --profile device`는 가능한 경우 ngrok을 별도 터미널 탭/패널로 분리 실행합니다
  (불가 환경에서는 기존 인라인 실행으로 자동 폴백).
- `scripts/devbox --log-file PATH up ...`를 사용하면 devbox 전체 stdout/stderr를 파일로 저장합니다.
  `PATH`가 상대경로면 저장소 루트 기준이며, `auto`를 주면 `.devbox-logs/`에 타임스탬프 파일을 생성합니다.
  ngrok이 별도 터미널에서 실행되면 ngrok 로그는 해당 터미널에서 확인합니다.
  `.devbox-logs/` 폴더는 gitignore 처리되어 로그가 커밋되지 않습니다.
- `scripts/devbox mobile --platform ios|android|all`로 기기 연결 시 RN/네이티브 앱 빌드/설치 자동화를 수행합니다.
  iOS는 `--ios-runtime rn|native|both`를 지원하며, 네이티브 설치 대상은 `--ios-coredevice-id`로 지정할 수 있습니다.
- `scripts/devbox ios-native-build --ios-configuration Debug|Release`로 `mingle-ios`만 빌드할 수 있습니다(설치 없음).
- `scripts/devbox ios-rn-ipa --device-app-env prod` 또는 `scripts/devbox ios-rn-ipa-prod`로
  RN iOS `.xcarchive`/`.ipa`를 App Store 업로드용으로 생성할 수 있습니다.
  이 명령은 `.devbox.env` 없이도 동작하며(`--device-app-env`/`--site-url`/`--ws-url` 권장),
  URL은 Vault/`.env.local`/쉘 환경변수에서 읽을 수 있습니다.
  Team ID를 고정하려면 `.zshrc`(또는 셸)에 `export DEVBOX_IOS_TEAM_ID=3RFBMN8TKZ`를 넣거나,
  `.devbox.env`에 같은 키를 넣어 사용하세요.
- `scripts/devbox up --profile device --with-mobile-install`으로 서버 준비 + 모바일 설치를 한 번에 실행할 수 있습니다.
- `scripts/devbox test --target app|ios-native|all`로 live 테스트와 네이티브 iOS 테스트 빌드를 분리/통합 실행할 수 있습니다.

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
