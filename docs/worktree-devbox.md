# Worktree Devbox Automation

브랜치/워크트리마다 로컬 테스트 환경을 분리해 쓰기 위한 자동화 가이드입니다.

## 목적

- 워크트리별 포트 충돌 방지
- `mingle-app` + `mingle-stt` 동시 실행 단일 명령 제공
- PC웹/iOS웹/안드웹/iOS앱/안드앱 테스트 URL/WS 자동 동기화
- 디바이스 테스트용 ngrok 상시 지원
- live 테스트(`pnpm test:live`) 포트 자동 주입
- `mingle-ios` 네이티브 빌드/테스트 동시 자동화

## 빠른 시작

```bash
# 1) 워크트리에서 1회 초기화
scripts/devbox init

# 2) 읽기 전용 bootstrap + 의존성 설치
scripts/devbox bootstrap

# 2-b) (선택) Vault 경로 저장
scripts/devbox bootstrap \
  --vault-app-path secret/mingle-app/dev \
  --vault-stt-path secret/mingle-stt/dev

# 2-c) (선택) .env.local -> Vault로 업로드
scripts/devbox bootstrap --vault-push

# 3) 현재 상태 확인
scripts/devbox status

# 4) 로컬 프로필로 서버 실행 (mingle-app + mingle-stt)
scripts/devbox up --profile local

# 5) 디바이스 프로필로 서버+ngrok 실행
scripts/devbox up --profile device

# 5-b) 디바이스 앱 빌드 URL을 Vault dev/prod로 선택
scripts/devbox up --profile device --device-app-env dev
scripts/devbox up --profile device --device-app-env prod

# 6) (선택) 연결된 테스트폰 앱 빌드/설치
scripts/devbox mobile --platform all --ios-runtime both

# 7) (선택) 서버+모바일 설치를 한 번에
scripts/devbox up --profile device --with-mobile-install

# 8) (선택) iOS만 설치
scripts/devbox up --profile device --with-ios-install

# 8-1) (선택) 기존 iOS 앱 삭제 후 재설치
scripts/devbox up --profile device --with-ios-install --with-ios-clean-install

# 9) (선택) iOS 네이티브만 설치
scripts/devbox mobile --platform ios --ios-runtime native

# 10) (선택) mingle-ios만 빌드(설치 없음)
scripts/devbox ios-native-build --ios-configuration Debug

# 11) (선택) RN iOS App Store/TestFlight용 ipa 생성
scripts/devbox ios-rn-ipa --device-app-env prod
scripts/devbox ios-rn-ipa-prod

# 12) (선택) mingle-ios 앱만 제거
scripts/devbox ios-native-uninstall --ios-native-target simulator --ios-simulator-udid <UDID>

# 13) (선택) 전체 로그를 파일로 저장
scripts/devbox --log-file auto up --profile device --with-ios-install

# 14) (선택) 테스트 실행
scripts/devbox test --target app
scripts/devbox test --target ios-native
scripts/devbox test --target all

# 15) (권장) 로컬 서버 + 네이티브 iOS 시뮬레이터 클린 재설치 한 번에
scripts/devbox up --profile local --with-ios-install --with-ios-clean-install --ios-runtime native --ios-native-target simulator --ios-simulator-udid <UDID> --ios-configuration Debug
```

## 재부팅 후 실행 순서 (Codex 전달용)

아래 순서대로 실행하면 됩니다. (`.devbox.env`가 이미 있는 기준)

### A) 로컬 개발(ngrok 없이)

```bash
cd /Users/nam/.codex/worktrees/5387/mingle
git checkout <브랜치>

# Vault 세션이 만료된 경우만
vault login

# 의존성/환경 복구 (안전하게 항상 실행 가능)
scripts/devbox bootstrap

# OpenClaw gateway가 필요하면 (별도 터미널)
scripts/devbox gateway --mode dev

# mingle-stt + mingle-app 실행
scripts/devbox up --profile local
```

### B) 실기기 전체(앱 재설치 + ngrok + 서버 2개)

```bash
cd /Users/nam/.codex/worktrees/5387/mingle
git checkout <브랜치>

# Vault 세션이 만료된 경우만
vault login

scripts/devbox bootstrap
scripts/devbox up --profile device --with-ios-install --with-ios-clean-install --ios-runtime rn
```

### C) 로컬 `.env.local` 값을 Vault에 다시 반영해야 할 때

```bash
scripts/devbox bootstrap --vault-push
```

노트:
- `.devbox.env`가 없으면 `scripts/devbox up ...`이 `init`을 자동 실행합니다.
- Vault CLI 환경(`VAULT_ADDR`, `VAULT_NAMESPACE`)은
  셸(`.zshrc`) 또는 `mingle-app/.env.local`/`mingle-stt/.env.local`에 두면 자동 참조됩니다.

## 주요 명령

- `scripts/devbox init`
  - `.devbox.env` 생성
  - git worktree 목록 기준으로 이미 할당된 포트를 회피해 기본 포트 자동 선택
    (`web/stt/metro` + `ngrok inspector`)
  - `ngrok.mobile.local.yml` 생성
  - RN 워크스페이스 의존성(`mingle-app/rn`) 자동 설치/점검
  - iOS Pods 상태(`Podfile.lock` vs `Pods/Manifest.lock`) 자동 점검 후
    불일치/누락 시 `pod install` 자동 동기화
  - `--vault-app-path`, `--vault-stt-path`로 Vault 경로를 초기값으로 저장 가능

- `scripts/devbox bootstrap`
  - `.env.local`을 수정하지 않는 읽기 전용 동작
  - `mingle-app`, `mingle-stt` 의존성(`pnpm install`) 자동 설치
  - `mingle-app/rn` 의존성(`pnpm install`) 자동 설치
  - iOS Pods 상태(`Podfile.lock` vs `Pods/Manifest.lock`) 자동 점검 후
    불일치/누락 시 `pod install` 자동 동기화
  - `mingle-app/node_modules/.prisma/client` 생성물이 없으면 `db:generate` 자동 실행
  - 옵션으로 Vault KV 경로를 저장
    - `--vault-app-path <path>`
    - `--vault-stt-path <path>`
  - `.devbox.env`가 있으면 전달한 Vault 경로를 저장하고 재적용
  - `--vault-push`를 주면 `mingle-app/.env.local`, `mingle-stt/.env.local`의
    비관리 키를 Vault 경로로 업로드

- `scripts/devbox profile --profile local --host <LAN_IP>`
  - 같은 네트워크에서 실기기 직접 접속할 때 사용
  - `NEXT_PUBLIC_WS_URL`를 빈 값으로 두고 host+port 조합을 사용

- `scripts/devbox profile --profile device`
  - 현재 워크트리 ngrok inspector(`DEVBOX_NGROK_API_PORT`)에서 `devbox_web`, `devbox_stt` 터널 URL을 읽어
    `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`에 반영
  - 현재 워크트리 포트와 `config.addr`가 일치하고 `https/wss`인 터널만 허용

- `scripts/devbox gateway --mode dev|run`
  - 기본 OpenClaw 루트(`/Users/nam/openclaw`)에서 gateway 실행
  - `--openclaw-root <PATH>`로 루트 변경 가능
  - `--mode dev`: `pnpm gateway:dev`
  - `--mode run -- --bind loopback --port 18789`: `openclaw gateway run` 인자 전달

- `scripts/devbox up --profile device --device-app-env dev|prod`
  - 모바일 앱 빌드 URL을
    `secret/mingle-app/dev` 또는 `secret/mingle-app/prod`에서 직접 읽어 주입
    - 기준 키: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`
    - fallback(마이그레이션 호환): `MINGLE_API_BASE_URL`, `RN_WEB_APP_BASE_URL`, `MINGLE_WEB_APP_BASE_URL`, `MINGLE_WS_URL`, `RN_DEFAULT_WS_URL`, `MINGLE_DEFAULT_WS_URL`
  - `--device-app-env prod`면 ngrok 및 로컬 서버(mingle-app/mingle-stt) 기동을 생략
  - `--device-app-env dev`면 기존 device(ngrok) 흐름을 그대로 사용

- `scripts/devbox up --profile local|device`
  - `.devbox.env`가 없으면 `init`을 자동 실행(1커맨드 온보딩)
  - 의존성 설치를 자동 수행(Prisma client 누락 시 `db:generate` 포함)
  - `up`은 `.env.local` 자동 시드/동기화를 수행하지 않음
  - 저장된 Vault 경로가 있으면 비관리 키(API key 등)를
    서버 프로세스 환경변수로 런타임 주입(파일 미기록)
  - `.env.local` 갱신은 devbox가 수행하지 않음(수동 편집 원칙)
  - `mingle-stt` + `mingle-app` 동시 실행
  - `device` 프로필에서 ngrok이 없으면 iTerm/Terminal에 별도 탭/패널로 ngrok 실행 시도
    (실패 시 기존 인라인 실행으로 폴백)
  - `--with-ios-install`, `--with-android-install`, `--with-mobile-install`, `--with-ios-clean-install` 옵션으로
    연결된 테스트폰 앱 빌드/설치를 함께 수행
  - iOS 설치 시 `--ios-runtime rn|native|both`로 RN/네이티브 경로를 선택 가능
  - 네이티브 설치 대상은 `--ios-coredevice-id <ID>`로 지정 가능
  - 연결된/설치 가능한 기기가 없으면 해당 플랫폼 설치 단계는 자동 스킵
  - `--with-ios-clean-install`은 기존 iOS 앱 번들을 삭제한 뒤 재설치합니다.
  - `--profile device`면 ngrok이 없을 경우 함께 기동 후 터널 URL을 자동 반영
  - 이미 떠 있는 ngrok 터널이 다른 포트/프로토콜이면 즉시 실패(오접속 방지)
  - `--with-metro`를 추가하면 RN Metro도 함께 실행
  - `scripts/devbox --log-file <path|auto> up ...` 형식으로 실행하면
    devbox 전체 stdout/stderr를 로그 파일로 저장
    - 상대 경로는 저장소 루트 기준
    - `auto`는 `.devbox-logs/devbox-<worktree>-<timestamp>.log` 자동 생성
    - ngrok이 별도 탭/패널에서 실행되면 ngrok 로그는 해당 탭/패널에서 확인

- `scripts/devbox mobile --platform ios|android|all`
  - 실행 시작 시 `.devbox.env`의 현재 프로필(local/device)을 다시 적용해
    최신 URL/WS 값을 먼저 재동기화한 뒤 빌드/설치를 수행
    (device 프로필은 ngrok inspector에서 최신 터널 URL 재조회)
  - iOS는 `--ios-runtime rn|native|both`로 RN/네이티브(또는 동시) 설치를 선택
  - `--device-app-env dev|prod`를 주면 앱 빌드 URL만 Vault 경로에서 덮어씁니다.
  - RN iOS/Android는 devbox URL(`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`) 기준으로
    빌드/설치를 수행
  - 네이티브 iOS도 동일하게 `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`를 주입해 설치
  - `--ios-udid`, `--ios-coredevice-id`, `--android-serial`로 대상 기기 지정 가능
  - `--ios-configuration Debug|Release` (기본 Release)
  - `--android-variant debug|release` (기본 release)
  - `--with-ios-clean-install`은 RN뿐 아니라 네이티브 iOS 설치에서도 기존 앱을 먼저 삭제
  - 연결 기기 미탐지 시 자동 스킵

- `scripts/devbox ios-native-build`
  - `mingle-ios/scripts/build-ios.sh`를 호출해 네이티브 iOS만 빌드(설치 없음)
  - `.devbox.env`가 있으면 `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`를 devbox 값으로 주입
  - `.devbox.env`가 없으면 `mingle-ios/Config/*.xcconfig` 기본 URL을 사용
  - `--ios-configuration Debug|Release` (기본 Debug)
  - `--ios-coredevice-id <ID>`를 주면 해당 실기기 타깃으로 빌드

- `scripts/devbox ios-rn-ipa`
  - RN iOS 앱을 `.xcarchive`/`.ipa`로 생성 (App Store/TestFlight 업로드 준비)
  - `.devbox.env` 없이도 실행 가능 (권장: `--device-app-env prod` 또는 `--site-url/--ws-url` 명시)
  - URL 조회 우선순위: `--device-app-env/--site-url` > `.devbox.env` > Vault/`.env.local`/쉘 환경변수
  - 기본값: `Release`, `export-method=app-store`
  - Team ID 우선순위: `--team-id` > `DEVBOX_IOS_TEAM_ID`(셸/.devbox.env) > `rnnative.xcodeproj`의 `DEVELOPMENT_TEAM`
  - `--device-app-env prod`로 `secret/mingle-app/prod` URL/WS를 주입
  - `--site-url`, `--ws-url`로 런타임 URL 수동 오버라이드 가능
  - `--archive-path`, `--export-path`, `--export-options-plist` 커스텀 경로 지원
  - `--skip-export`는 archive까지만 생성, `--dry-run`은 명령만 출력
  - `scripts/devbox ios-rn-ipa-prod`는 `--device-app-env prod`를 기본 적용한 별칭

- `scripts/devbox test --target app|ios-native|all`
  - `app`: 현재 devbox 설정값으로 `mingle-app` live integration test 실행
  - `ios-native`: `mingle-ios/scripts/test-ios.sh`를 통해 네이티브 iOS test build 실행
  - `all`: 두 테스트를 순서대로 실행
  - iOS는 `--ios-configuration Debug|Release` 지정 가능

## ngrok 연동

`scripts/ngrok-start-mobile.sh`는 아래 우선순위로 설정 파일을 선택합니다.

1. `ngrok.mobile.local.yml` (devbox 생성 파일)
2. `ngrok.mobile.yml` (기본 저장소 파일)

즉 `scripts/devbox init` 후에는 워크트리별 포트 기준으로 ngrok이 바로 동작합니다.
또한 inspector 포트도 워크트리별로 분리되어(`DEVBOX_NGROK_API_PORT`) 충돌 가능성을 줄입니다.

## ngrok Free 플랜 참고

- `device` 프로필은 워크트리당 ngrok endpoint 2개(`devbox_web`, `devbox_stt`)를 사용합니다.
- ngrok Free 한도는 계정 생성 시점/플랜 정책에 따라 `online endpoint`가 1~3으로 다를 수 있습니다.
- 따라서 단일 계정 Free 플랜에서는 `device` 프로필 워크트리 2개 동시(총 endpoint 4개)가
  제한에 걸릴 가능성이 높습니다. (정확 한도는 ngrok 대시보드에서 확인)

## 생성/수정 파일

- `.devbox.env`
- `mingle-app/.env.local` (devbox는 읽기/참조만 함)
- `mingle-stt/.env.local` (devbox는 읽기/참조만 함)
- `ngrok.mobile.local.yml`
- `.devbox-logs/` (`--log-file` 사용 시 생성, gitignore)

## Vault 사용 전제

- `vault` CLI와 `jq`가 로컬에 설치되어 있어야 합니다.
- `vault login` 등으로 인증이 선행되어야 합니다.
- `VAULT_ADDR`/`VAULT_NAMESPACE`는 셸(`.zshrc`) 또는 `.env.local`에 둘 수 있습니다.
- devbox는 Vault 값을 `.env.local`에 자동 반영하지 않습니다(런타임 주입만 수행).
- `--vault-push`는 `.env.local`의 비관리 키를 Vault로 업로드합니다.
