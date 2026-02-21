# Release Namespace Rollout Checklist

## 1) Environment Matrix

| Target | Required Namespace | Required Env |
|---|---|---|
| Web App | `web/app/v1` | `NEXT_PUBLIC_API_NAMESPACE=web/app/v1` |
| iOS App (RN WebView) | `mobile/ios/v1` | `RN_API_NAMESPACE=mobile/ios/v1` |
| Android App (RN WebView) | `mobile/android/v1` | `RN_API_NAMESPACE=mobile/android/v1` |
| Landing Web | `web/landing/v1` | `NEXT_PUBLIC_API_NAMESPACE=web/landing/v1` |

## 2) Build Commands

```bash
# App web bundles
pnpm --dir mingle-app build:release:web
pnpm --dir mingle-app build:release:ios
pnpm --dir mingle-app build:release:android

# Landing
pnpm --dir mingle-landing build:release:web
```

## 3) Runtime URL Contract

- App/Landing 클라이언트는 `/api/{namespace}/...` 형식으로 호출합니다.
- URL query override 지원:
  - `apiNamespace` 또는 `apiNs`
  - app 허용값: `web/app/v1`, `mobile/ios/v1`, `mobile/android/v1`
  - landing 허용값: `web/landing/v1`
  - 예: `?apiNamespace=mobile/ios/v1`
  - 허용되지 않은 값은 무시됩니다.

## 4) RN Runtime Contract

- RN WebView URL은 `apiNamespace` 쿼리를 자동 전달합니다.
- `RN_API_NAMESPACE`는 필수이며 현재 플랫폼 기준값과 일치해야 합니다.
  - iOS: `mobile/ios/v1`
  - Android: `mobile/android/v1`
- 값이 없거나 불일치하면 WebView를 로드하지 않고 오류를 표시합니다.

## 5) Legacy Endpoint Decommission Plan

- 현재 상태: legacy `/api/*` 래퍼 유지(호환)
- 권장 단계:
  1. 1주: 로그에서 legacy 호출 0건 확인
  2. 2주: legacy route에 299 deprecation header 추가
  3. 3주: legacy route 제거
