# App Store Preview 로컬라이징 작업 설명서

이 문서는 `mingle-app` 기준으로, App Store Preview(로컬 서버) 프로젝트를 복제하고
언어별 스크린샷 문구를 반영하는 현재 작업 흐름을 정리한 문서입니다.

## 1) 범위

- 대상 서버: `http://localhost:4318` (appstore-preview API)
- 기준 프로젝트: `Mingle 한국어` 또는 `Mingle 영어`
- 소스 텍스트: `rn/appstore-connect-info/appstore-connect-info.i18n.json`
- 자동화 스크립트: `scripts/ios-appstore-preview-clone-locale.ts`

## 2) 지금까지 진행한 핵심 작업

1. App Store Connect 메타데이터를 `appstore-connect-info.i18n.json` 구조로 정리했습니다.
2. 스크린샷 문구를 언어별 배열(`line1`, `line2`)로 관리하도록 맞췄습니다.
3. App Store Preview API로 프로젝트/캔버스를 직접 조작 가능한 흐름을 확인했습니다.
4. 한국어/영어 프로젝트 기준으로 캔버스 복제, 텍스트 교체, 정렬 보정 작업을 반복 수행했습니다.
5. 일본어 프로젝트(`Mingle 일본어`) 생성 및 텍스트 반영까지 검증했습니다.

## 3) 자동화 스크립트 동작 순서

`ios-appstore-preview-clone-locale.ts`는 아래 순서로 실행됩니다.

1. i18n JSON에서 대상 locale의 스크린샷 문구를 읽습니다.
2. 소스 프로젝트(기본: `Mingle 한국어`)를 복제해 타겟 프로젝트를 만듭니다.
3. 각 캔버스의 이름/텍스트를 locale 문구로 교체합니다.
4. 소스 프로젝트의 미디어(이미지/영상)를 캔버스 인덱스 기준으로 복사합니다.
5. 텍스트 박스를 문구 폭에 맞춰 줄이고, X축 중앙 정렬합니다.

## 4) 실행 방법

프로젝트 루트(`/Users/nam/mingle/mingle-app`)에서 실행합니다.

```bash
pnpm dlx tsx scripts/ios-appstore-preview-clone-locale.ts \
  --locale ja \
  --target-project-name "Mingle 일본어"
```

옵션:

- `--source-project-name` 기본값: `Mingle 한국어`
- `--api-base` 기본값: `http://localhost:4318`
- `--i18n-json` 기본값: `rn/appstore-connect-info/appstore-connect-info.i18n.json`
- `--dry-run` 지정 시 실제 생성 없이 입력 검증만 진행

예시(프랑스어):

```bash
pnpm dlx tsx scripts/ios-appstore-preview-clone-locale.ts \
  --locale fr \
  --target-project-name "Mingle 프랑스어"
```

## 5) 주의사항

1. appstore-preview 웹 UI(5173)를 열어둔 상태에서 수동 편집 중이면 자동 저장이 API 결과를 덮어쓸 수 있습니다.
2. 동일 이름 프로젝트가 여러 개 생길 수 있으니, 최종본만 남기고 정리해 주세요.
3. 문구 길이가 긴 언어는 줄바꿈 위험이 있어 결과 캔버스 확인이 필요합니다.

## 6) 검수 체크리스트

1. 대상 프로젝트가 생성되었는지 확인
2. 캔버스 개수/순서가 기대값과 일치하는지 확인
3. 각 캔버스 `line1`, `line2` 문구 반영 여부 확인
4. 텍스트가 가운데 정렬되어 있고 줄바꿈이 없는지 확인
5. 미디어(특히 1번 영상 캔버스)가 정상인지 확인

