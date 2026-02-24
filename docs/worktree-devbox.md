# Worktree Devbox Automation

브랜치/워크트리마다 로컬 테스트 환경을 분리해 쓰기 위한 자동화 가이드입니다.

## 목적

- 워크트리별 포트 충돌 방지
- `mingle-app` + `mingle-stt` 동시 실행 단일 명령 제공
- PC웹/iOS웹/안드웹/iOS앱/안드앱 테스트 URL/WS 자동 동기화
- 디바이스 테스트용 ngrok 상시 지원
- live 테스트(`pnpm test:live`) 포트 자동 주입

## 빠른 시작

```bash
# 1) 워크트리에서 1회 초기화
scripts/devbox init

# 2) 메인 워크트리 env 시드 + 의존성 설치
scripts/devbox bootstrap

# 2-b) (선택) Vault에서 env 키 동기화
scripts/devbox bootstrap \
  --vault-app-path secret/mingle-app/dev \
  --vault-stt-path secret/mingle-stt/dev

# 3) 현재 상태 확인
scripts/devbox status

# 4) 로컬 프로필로 서버 실행 (mingle-app + mingle-stt)
scripts/devbox up --profile local

# 5) 디바이스 프로필로 서버+ngrok 실행
scripts/devbox up --profile device

# 5-b) 실서버 프로필로 앱 빌드용 URL 주입
scripts/devbox up --profile prod \
  --vault-app-path secret/mingle-app/prod \
  --vault-stt-path secret/mingle-stt/prod

# 6) (선택) 연결된 테스트폰 앱 빌드/설치
scripts/devbox mobile --platform all

# 7) (선택) 서버+모바일 설치를 한 번에
scripts/devbox up --profile device --with-mobile-install

# 8) (선택) iOS만 설치
scripts/devbox up --profile device --with-ios-install

# 8-1) (선택) 기존 iOS 앱 삭제 후 재설치
scripts/devbox up --profile device --with-ios-install --with-ios-clean-install

# 9) (선택) 전체 로그를 파일로 저장
scripts/devbox --log-file auto up --profile device --with-ios-install
```

## 주요 명령

- `scripts/devbox init`
  - `.devbox.env` 생성
  - git worktree 목록 기준으로 이미 할당된 포트를 회피해 기본 포트 자동 선택
    (`web/stt/metro` + `ngrok inspector`)
  - 현재 워크트리 `.env.local`에 비관리 키가 없으면 main 워크트리의
    `mingle-app/.env.local`, `mingle-stt/.env.local`을 시드
  - `mingle-app/.env.local` devbox 관리 블록 갱신
    (`NEXTAUTH_URL` 포함)
  - `mingle-stt/.env.local` 포트 블록 갱신
  - `ngrok.mobile.local.yml` 생성
  - RN 워크스페이스 의존성(`mingle-app/rn`) 자동 설치/점검
  - iOS Pods 상태(`Podfile.lock` vs `Pods/Manifest.lock`) 자동 점검 후
    불일치/누락 시 `pod install` 자동 동기화
  - `NEXTAUTH_SECRET`/`AUTH_SECRET`이 모두 없으면 devbox 기본 secret 자동 주입

- `scripts/devbox bootstrap`
  - main 워크트리의 `mingle-app/.env.local`, `mingle-stt/.env.local`을 현재 워크트리에 시드
  - `mingle-app`, `mingle-stt` 의존성(`pnpm install`) 자동 설치
  - `mingle-app/rn` 의존성(`pnpm install`) 자동 설치
  - iOS Pods 상태(`Podfile.lock` vs `Pods/Manifest.lock`) 자동 점검 후
    불일치/누락 시 `pod install` 자동 동기화
  - `NEXTAUTH_SECRET`/`AUTH_SECRET`이 모두 없으면 devbox 기본 secret 자동 주입
  - `mingle-app/node_modules/.prisma/client` 생성물이 없으면 `db:generate` 자동 실행
  - 옵션으로 Vault KV 경로를 주면 해당 키를 비관리 영역에 반영
    - `--vault-app-path <path>`
    - `--vault-stt-path <path>`
  - `.devbox.env`가 있으면 전달한 Vault 경로를 저장하고(devbox 관리 블록 포함) 재적용

- `scripts/devbox profile --profile local --host <LAN_IP>`
  - 같은 네트워크에서 실기기 직접 접속할 때 사용
  - `NEXT_PUBLIC_WS_URL`를 빈 값으로 두고 host+port 조합을 사용

- `scripts/devbox profile --profile device`
  - 현재 워크트리 ngrok inspector(`DEVBOX_NGROK_API_PORT`)에서 `devbox_web`, `devbox_stt` 터널 URL을 읽어
    `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`, `RN_DEFAULT_WS_URL`에 반영
  - 현재 워크트리 포트와 `config.addr`가 일치하고 `https/wss`인 터널만 허용
- `scripts/devbox profile --profile prod`
- `mingle-app/.env.local` 또는 `mingle-app/.env`에서 먼저 찾고,
  `RN_WEB_APP_BASE_URL`/`MINGLE_WEB_APP_BASE_URL`/`NEXT_PUBLIC_SITE_URL`,
  `RN_DEFAULT_WS_URL`/`MINGLE_DEFAULT_WS_URL`/`NEXT_PUBLIC_WS_URL`를 읽어 현재 프로필로 설정
  - `--vault-app-path`가 지정된 경우 Vault 경로도 동일 우선순위에 포함해 읽어
    설정값을 덮어쓰지 않고 주입 전용 값으로 사용합니다.
  - `--vault-app-path/--vault-stt-path`로 `.env.local` 동기화 후 실행하면
    Vault에 저장된 프로덕션 URL을 자동 반영

- `scripts/devbox up --profile local|device|prod`
  - `.devbox.env`가 없으면 `init`을 자동 실행(1커맨드 온보딩)
  - 시작 전에 main 워크트리 env 시드와 의존성 설치를 자동 수행
    (Prisma client 누락 시 `db:generate` 포함)
  - 이전에 저장된 Vault 경로가 있으면 자동으로 env 동기화 수행
  - 필요 시 `--vault-app-path/--vault-stt-path`로 경로를 덮어써 즉시 반영 가능
  - `mingle-stt` + `mingle-app` 동시 실행
  - `device` 프로필에서 ngrok이 없으면 iTerm/Terminal에 별도 탭/패널로 ngrok 실행 시도
    (실패 시 기존 인라인 실행으로 폴백)
- `--with-ios-install`, `--with-android-install`, `--with-mobile-install`, `--with-ios-clean-install` 옵션으로
  연결된 테스트폰 앱 빌드/설치를 함께 수행
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
  - 실행 시작 시 `.devbox.env`의 현재 프로필(local/device/prod)을 다시 적용해
    최신 URL/WS 값을 먼저 재동기화한 뒤 빌드/설치를 수행
    (device 프로필은 ngrok inspector에서 최신 터널 URL 재조회)
  - 현재 워크트리 devbox URL(`RN_WEB_APP_BASE_URL`, `RN_DEFAULT_WS_URL`) 기준으로
    RN iOS/Android 빌드/설치를 수행
  - `--ios-udid`, `--android-serial`로 대상 기기 지정 가능
  - `--ios-configuration Debug|Release` (기본 Release)
  - `--android-variant debug|release` (기본 release)
  - 연결 기기 미탐지 시 자동 스킵

- `scripts/devbox test`
  - 현재 devbox 설정값으로 `mingle-app` live integration test 실행
  - 내부적으로 `MINGLE_TEST_API_BASE_URL`, `MINGLE_TEST_WS_URL`를 자동 주입

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
- `mingle-app/.env.local` (관리 블록만)
- `mingle-stt/.env.local` (관리 블록만)
- `ngrok.mobile.local.yml`
- `.devbox-logs/` (`--log-file` 사용 시 생성, gitignore)

관리 블록은 아래 마커 사이만 자동 갱신합니다.

```text
# >>> devbox managed (auto)
# <<< devbox managed (auto)
```

## Vault 사용 전제

- `vault` CLI와 `jq`가 로컬에 설치되어 있어야 합니다.
- `vault login` 등으로 인증이 선행되어야 합니다.
- Vault 동기화는 devbox 관리 키(`PORT`, `NEXT_PUBLIC_SITE_URL` 등)는 덮어쓰지 않고,
  비관리 키만 반영합니다.
