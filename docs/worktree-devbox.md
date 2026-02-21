# Worktree Devbox Automation

브랜치/워크트리마다 로컬 테스트 환경을 분리해서 쓰기 위한 자동화 가이드입니다.

## 목적

- 워크트리별 포트 충돌 방지
- `mingle-app` + `mingle-stt` 동시 실행 단일 명령 제공
- iOS/Android Web/App 테스트에 필요한 URL/WS env를 자동 동기화
- ngrok 사용 시 로컬 포트 기반 설정 자동 반영
- 기존 `NEXT_PUBLIC_WS_URL` 잔존으로 인한 오접속 방지

## 빠른 시작

```bash
# 1) 워크트리에서 1회 초기화
scripts/devbox.sh init

# 2) 상태 확인 (PC웹, iOS웹, iOS앱, 안드앱, 안드웹 값 출력)
scripts/devbox.sh status

# 3) 서버 실행 (STT + Next)
scripts/devbox.sh up

# 4) 필요 시 Metro까지
scripts/devbox.sh up --with-metro
```

## 주요 명령

- `scripts/devbox.sh init`
  - `.devbox.env` 생성
  - git worktree 목록 기준으로 이미 할당된 포트를 회피해 기본 포트 자동 선택
  - `mingle-app/.env.local` devbox 관리 블록 갱신
  - `mingle-stt/.env.local` 포트 블록 갱신
  - `ngrok.mobile.local.yml` 생성

- `scripts/devbox.sh profile-local --host <LAN_IP>`
  - 디바이스가 같은 네트워크에서 직접 접속할 때 사용
  - 예: `--host 192.168.0.12`
  - `NEXT_PUBLIC_WS_URL`를 빈 값으로 강제해 stale ngrok URL 잔존을 제거

- `scripts/devbox.sh profile-ngrok`
  - ngrok inspector(`http://127.0.0.1:4040`)에서 `web`, `stt` 터널 URL을 읽어
    `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WS_URL`, `RN_DEFAULT_WS_URL`에 반영

- `scripts/devbox.sh test-live`
  - 현재 devbox 설정값으로 `mingle-app` live integration test 실행

## ngrok 연동

`scripts/ngrok-start-mobile.sh`는 아래 우선순위로 설정 파일을 선택합니다.

1. `ngrok.mobile.local.yml` (devbox 생성 파일)
2. `ngrok.mobile.yml` (기본 저장소 파일)

즉, 워크트리별 포트로 `scripts/devbox.sh init`을 먼저 실행해두면,
이후 ngrok 실행도 해당 포트 기준으로 동작합니다.

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
