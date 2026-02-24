# Release Namespace Rollout Checklist

## 1) Environment Matrix

| Target | API prefix | Required Env |
|---|---|---|
| Web App (legacy) | `/api/{path}` | `NEXT_PUBLIC_API_NAMESPACE=` |
| iOS App (versioned) | `/api/ios/v1.0.0/{path}` | `RN_API_NAMESPACE=ios/v1.0.0` |
| Android App (legacy) | `/api/{path}` | `RN_API_NAMESPACE=` (optional) |

## 2) Build Commands

```bash
pnpm --dir mingle-app build:release:web
pnpm --dir mingle-app build:release:ios
pnpm --dir mingle-app build:release:android
```

## 3) Runtime URL Contract

- 클라이언트는 `/api/{namespace?}/{path}` 형식으로 호출합니다.
- URL query override:
  - `apiNamespace` 또는 `apiNs`
  - allow-list: `''`, `ios/v1.0.0`
  - 예: `?apiNamespace=ios/v1.0.0`

## 4) Legacy + iOS v1.0.0 Policy

- legacy 무버전 경로는 현재 유지합니다.
- iOS versioned 경로(`/api/ios/v1.0.0/*`)는 legacy와 동일 로직을 사용합니다.

## 5) Contract Test Coverage

- `src/lib/api-contract.test.ts`
- `src/lib/rn-api-namespace.test.ts`
- `src/app/api/namespace-routing.contract.test.ts`
