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
- `SONIOX_MANUAL_FINALIZE_SILENCE_MS` (optional, default: `200`, range: `100..1000`)
  - Soniox 실시간 텍스트가 추가되지 않은 채 이 시간이 지나면 수동 finalize를 요청합니다.
- `SONIOX_MANUAL_FINALIZE_COOLDOWN_MS` (optional, default: `1200`, range: `300..5000`)

`mingle-stt` loads `.env.local` first, then `.env` in this directory.
If these variables are missing, it safely falls back to the defaults above.

## Railway

This folder includes `railway.json` and is intended to be used as the Railway
service root directory.
