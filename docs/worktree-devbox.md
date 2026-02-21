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
```

## 주요 명령

- `scripts/devbox init`
  - `.devbox.env` 생성
  - git worktree 목록 기준으로 이미 할당된 포트를 회피해 기본 포트 자동 선택
  - 현재 워크트리 `.env.local`에 비관리 키가 없으면 main 워크트리의
    `mingle-app/.env.local`, `mingle-stt/.env.local`을 시드
  - `mingle-app/.env.local` devbox 관리 블록 갱신
  - `mingle-stt/.env.local` 포트 블록 갱신
  - `ngrok.mobile.local.yml` 생성

- `scripts/devbox bootstrap`
  - main 워크트리의 `mingle-app/.env.local`, `mingle-stt/.env.local`을 현재 워크트리에 시드
  - `mingle-app`, `mingle-stt` 의존성(`pnpm install`) 자동 설치
  - 옵션으로 Vault KV 경로를 주면 해당 키를 비관리 영역에 반영
    - `--vault-app-path <path>`
    - `--vault-stt-path <path>`
  - `.devbox.env`가 있으면 devbox 관리 블록 재적용

- `scripts/devbox profile --profile local --host <LAN_IP>`
  - 같은 네트워크에서 실기기 직접 접속할 때 사용
  - `NEXT_PUBLIC_WS_URL`를 빈 값으로 두고 host+port 조합을 사용

- `scripts/devbox profile --profile device`
  - ngrok inspector(`http://127.0.0.1:4040`)에서 `web`, `stt` 터널 URL을 읽어
    `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`, `RN_DEFAULT_WS_URL`에 반영
  - 현재 워크트리 포트와 `config.addr`가 일치하고 `https/wss`인 터널만 허용

- `scripts/devbox up --profile local|device`
  - 시작 전에 main 워크트리 env 시드와 의존성 설치를 자동 수행
  - 필요 시 `--vault-app-path/--vault-stt-path`로 Vault 값까지 즉시 반영 가능
  - `mingle-stt` + `mingle-app` 동시 실행
  - `--profile device`면 ngrok이 없을 경우 함께 기동 후 터널 URL을 자동 반영
  - 이미 떠 있는 ngrok 터널이 다른 포트/프로토콜이면 즉시 실패(오접속 방지)
  - `--with-metro`를 추가하면 RN Metro도 함께 실행

- `scripts/devbox test`
  - 현재 devbox 설정값으로 `mingle-app` live integration test 실행
  - 내부적으로 `MINGLE_TEST_API_BASE_URL`, `MINGLE_TEST_WS_URL`를 자동 주입

## ngrok 연동

`scripts/ngrok-start-mobile.sh`는 아래 우선순위로 설정 파일을 선택합니다.

1. `ngrok.mobile.local.yml` (devbox 생성 파일)
2. `ngrok.mobile.yml` (기본 저장소 파일)

즉 `scripts/devbox init` 후에는 워크트리별 포트 기준으로 ngrok이 바로 동작합니다.

## 생성/수정 파일

- `.devbox.env`
- `mingle-app/.env.local` (관리 블록만)
- `mingle-stt/.env.local` (관리 블록만)
- `ngrok.mobile.local.yml`

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
