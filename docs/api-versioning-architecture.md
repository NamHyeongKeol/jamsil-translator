# API/Frontend Versioning Architecture

## Rules

1. Platform/version 분기는 런타임 `if` 로 하지 않습니다.
2. 구분 정보는 URL에만 둡니다.
3. 라우트와 컨트롤러는 파일 단위로 분리합니다.
4. 공통 로직은 handler/service 모듈을 재사용합니다.

## URL Contract

- 모바일 iOS v1: `/api/mobile/ios/v1/...`
- 모바일 Android v1: `/api/mobile/android/v1/...`
- 웹 app v1: `/api/web/app/v1/...`
- 웹 landing v1: `/api/web/landing/v1/...`

## Current Endpoint Map

### mingle-app

- `POST /api/{namespace}/translate/finalize`
- `POST /api/{namespace}/tts/inworld`
- `POST /api/{namespace}/log/client-event`

Namespaces:

- `web/app/v1`
- `mobile/ios/v1`
- `mobile/android/v1`

### mingle-landing

- `POST /api/web/landing/v1/log-click`
- `POST /api/web/landing/v1/log-visit`
- `POST /api/web/landing/v1/log-event`
- `POST /api/web/landing/v1/log-conversation`
- `POST /api/web/landing/v1/subscribe`
- `GET /api/web/landing/v1/clicks`
- `GET /api/web/landing/v1/subscribers`
- `POST /api/web/landing/v1/translate/finalize`
- `POST /api/web/landing/v1/tts/inworld`

## Controller/Handler Separation

### mingle-app

- Controllers
  - `mingle-app/src/server/api/controllers/mobile/ios/v1/*`
  - `mingle-app/src/server/api/controllers/mobile/android/v1/*`
  - `mingle-app/src/server/api/controllers/web/app/v1/*`
- Shared handlers
  - `mingle-app/src/server/api/handlers/v1/*`

### mingle-landing

- Controllers
  - `mingle-landing/server/api/controllers/web/landing/v1/*`

## Frontend Routing Strategy (No platform/version if)

- `mingle-app`: `NEXT_PUBLIC_API_NAMESPACE` 사용 (default: `web/app/v1`)
- `mingle-landing`: `NEXT_PUBLIC_API_NAMESPACE` 사용 (default: `web/landing/v1`)
- 클라이언트는 `buildClientApiPath` / `buildLandingApiPath`로만 API URL 생성
- URL 쿼리 `apiNamespace`(또는 `apiNs`)는 allow-list 값일 때만 env보다 우선 적용
  - app allow-list: `web/app/v1`, `mobile/ios/v1`, `mobile/android/v1`
  - landing allow-list: `web/landing/v1`

## Release Configuration Example

- iOS release web bundle: `NEXT_PUBLIC_API_NAMESPACE=mobile/ios/v1`
- Android release web bundle: `NEXT_PUBLIC_API_NAMESPACE=mobile/android/v1`
- Browser web app: `NEXT_PUBLIC_API_NAMESPACE=web/app/v1`
- Landing web: `NEXT_PUBLIC_API_NAMESPACE=web/landing/v1`
- RN WebView 런타임 오버라이드: `RN_API_NAMESPACE`(필수) -> `?apiNamespace=...` 전달
- `RN_API_NAMESPACE`가 플랫폼(iOS/Android) 기준값과 다르면 WebView 로드 차단(오류 표시)

## Compatibility Policy

레거시 무버전 경로(`/api/translate/finalize` 등)는 허용하지 않습니다.
레거시 경로 요청은 `410 Gone`과 `X-Mingle-Api-Replacement` 헤더를 반환하며,
클라이언트는 반드시 `/api/{namespace}/v1/...` 형태의 URL만 사용해야 합니다.
