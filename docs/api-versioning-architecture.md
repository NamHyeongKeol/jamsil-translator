# API/Frontend Versioning Architecture

## Rules

1. 플랫폼/버전 분기는 URL로만 합니다.
2. 컨트롤러는 URL 스코프별로 파일을 분리합니다.
3. 공통 로직은 handler 모듈을 공유합니다.
4. 현재 단계는 `legacy + iOS v1.0.0`만 운영합니다.

## URL Contract (Current Phase)

- Legacy (무버전): `/api/{existing-path}`
- iOS versioned: `/api/ios/v1.0.0/{existing-path}`

현재 `existing-path`:

- `translate/finalize`
- `tts/inworld`
- `log/client-event`

## Controller Separation

- Legacy controllers:
  - `mingle-app/src/server/api/controllers/legacy/*`
- iOS v1.0.0 controllers:
  - `mingle-app/src/server/api/controllers/ios/v1.0.0/*`
- Shared handlers:
  - `mingle-app/src/server/api/handlers/v1/*`

iOS v1.0.0 컨트롤러는 legacy 컨트롤러와 동일 코드를 사용합니다.

## Frontend Routing Strategy

- 기본값: `NEXT_PUBLIC_API_NAMESPACE=''` (legacy 경로 호출)
- iOS versioned 호출: `NEXT_PUBLIC_API_NAMESPACE=ios/v1.0.0`
- URL query override: `apiNamespace` 또는 `apiNs`
  - 허용값: `''`, `ios/v1.0.0`
  - 그 외 값은 무시

클라이언트는 `buildClientApiPath`로만 API 경로를 생성합니다.
