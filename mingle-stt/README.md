# mingle-stt

Standalone STT relay server for Mingle.

## Scripts

- `pnpm dev`: run `stt-server.ts` with `ts-node`
- `pnpm build`: compile to `dist/stt-server.js`
- `pnpm start`: run compiled server

## Environment Variables

- `PORT` (default: `3001`)
- `SONIOX_API_KEY`
- `GLADIA_API_KEY` (optional, for gladia modes)
- `DEEPGRAM_API_KEY` (optional, for deepgram modes)
- `FIREWORKS_API_KEY` (optional, for fireworks mode)
- `SONIOX_MANUAL_FINALIZE_SILENCE_MS` (optional, default: `250`, range: `100..1000`)
  - Soniox 실시간 텍스트가 추가되지 않은 채 이 시간이 지나면 수동 finalize를 요청합니다.
- `SONIOX_MANUAL_FINALIZE_COOLDOWN_MS` (optional, default: `1200`, range: `300..5000`)
- `SONIOX_DEBUG_LOG` (optional, default: `true` when `NODE_ENV!=production`, else `false`)
  - 활성화 시 Soniox 프레임마다 final/non-final 토큰 결합 텍스트, 토큰 시간 범위,
    manual finalize 타이머 상태를 로그로 출력합니다.
  - Soniox로 보내는 `{"type":"finalize"}` 요청(시도/성공/실패)도 모두 로그에 남깁니다.

`mingle-stt` loads `.env.local` first, then `.env` in this directory.
If these variables are missing, it safely falls back to the defaults above.

## Railway

This folder includes `railway.json` and is intended to be used as the Railway
service root directory.
