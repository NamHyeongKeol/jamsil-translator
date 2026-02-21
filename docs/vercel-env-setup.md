# Vercel Environment Setup (Namespace)

아래 값은 Vercel 대시보드 또는 CLI에서 프로젝트별로 등록합니다.

## mingle-app

- Preview/Production (web app):
  - `NEXT_PUBLIC_API_NAMESPACE=web/app/v1`

## mingle-landing

- Preview/Production:
  - `NEXT_PUBLIC_API_NAMESPACE=web/landing/v1`

## RN 앱 릴리즈

RN은 WebView URL에 query로 namespace를 주입합니다.

- iOS build env:
  - `RN_API_NAMESPACE=mobile/ios/v1`
- Android build env:
  - `RN_API_NAMESPACE=mobile/android/v1`

## Optional CLI pattern

```bash
# 프로젝트 연결 후
vercel env add NEXT_PUBLIC_API_NAMESPACE production
vercel env add NEXT_PUBLIC_API_NAMESPACE preview
```
