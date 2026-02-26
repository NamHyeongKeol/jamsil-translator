# App Store Legal Setup (Mingle iOS)

Date: 2026-02-26

## 1) Legal documents created in this repo

- Privacy Policy (public URL path): `/legal/privacy-policy.html`
- Terms of Use (public URL path): `/legal/terms-of-use.html`
- Legal index page: `/legal/`

Files:

- `mingle-app/public/legal/privacy-policy.html`
- `mingle-app/public/legal/terms-of-use.html`
- `mingle-app/public/legal/index.html`

## 2) Production URLs to use in App Store Connect

Use your production domain. Current default runtime domain in iOS project is:

- `https://mingle-app-xi.vercel.app`

Recommended values:

- Privacy Policy URL: `https://mingle-app-xi.vercel.app/legal/privacy-policy.html`
- Terms of Use URL: `https://mingle-app-xi.vercel.app/legal/terms-of-use.html`
- Support URL (if same site): `https://mingle-app-xi.vercel.app/`

## 3) App Store Connect input mapping

- App Information -> Privacy Policy URL:
  - set to `/legal/privacy-policy.html`
- App Information -> Support URL:
  - set to your support page (or website root)
- App Information -> License Agreement:
  - keep Apple standard EULA, or paste a custom EULA if legal team requires it
- App Store -> App Description:
  - if you sell auto-renewable subscriptions, include Terms and Privacy URLs in description text as well

## 4) Final pre-submit checks

- Verify both legal URLs return HTTP 200 in production.
- Verify policy/terms pages are reachable without login.
- Verify legal contact email/domain in both documents is correct for your company.
