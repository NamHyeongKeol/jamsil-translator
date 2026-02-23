# mingle-ios

`mingle-ios`는 `mingle-app`과 완전히 분리된 순수 iOS 네이티브(SwiftUI) 앱입니다.
기존 웹/RN 코드는 수정하지 않고, 백엔드(`mingle-app`의 TS + Prisma + API)만 그대로 사용합니다.

## 포함된 기능

- AVAudioEngine 기반 실시간 마이크 캡처
- WebSocket(`mingle-stt`) 연동 (`audio_chunk`, `transcript`, `stop_recording_ack`)
- STT 워크플로우 파서(Swift)
- `/api/translate/finalize` 호출로 최종 번역 반영
- 간단한 통역 로그 UI

## 디렉토리

- `project.yml`: XcodeGen 스펙
- `Config/*.xcconfig`: API/WS 기본 URL 설정
- `MingleIOS/`: 앱 소스
- `MingleIOSTests/`: 파서 단위 테스트
- `scripts/`: CLI 빌드/설치 스크립트

## 빠른 시작

```bash
cd mingle-ios
./scripts/build-ios.sh
```

## 연결 디바이스 설치/실행

```bash
cd mingle-ios
./scripts/list-ios-devices.sh
./scripts/install-ios-device.sh
# 또는 특정 디바이스 지정
./scripts/install-ios-device.sh <COREDEVICE_ID>
```

필요 시 코드사인 팀 지정:

```bash
DEVELOPMENT_TEAM=YOUR_TEAM_ID ./scripts/install-ios-device.sh <DEVICE_ID>
```

실기기 설치 전 필수 조건:

1. Xcode > Settings > Accounts에 Apple ID 로그인
2. iPhone 연결 + 잠금해제 + \"이 컴퓨터 신뢰\" 허용
3. 개발용 프로비저닝 프로필 자동 생성 가능 상태

## 백엔드 URL 변경

앱 내부 `Backend` 섹션에서 다음을 직접 변경할 수 있습니다.

- API Base URL (예: `http://<맥IP>:3000`)
- WS URL (예: `ws://<맥IP>:3001`)
- Languages (`en,ko,ja` 형태)

입력값은 앱 내 UserDefaults에 저장됩니다.
