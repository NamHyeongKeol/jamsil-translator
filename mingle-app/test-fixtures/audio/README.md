## Live STT Audio Fixtures

`pnpm test` now includes a live integration test that streams a WAV file to the local STT WebSocket server.

Default fixture path:

- `test-fixtures/audio/fixtures/stt-smoke.en.wav`

You can override it with:

- `MINGLE_TEST_AUDIO_FIXTURE=/absolute/path/to/fixture.wav`

Required fixture format:

- WAV (RIFF/WAVE)
- PCM 16-bit
- mono (1 channel)

### Git policy (recommended)

- Commit one short, sanitized baseline fixture under `test-fixtures/audio/fixtures/` for team reproducibility.
- Put personal or sensitive recordings under `test-fixtures/audio/local/` (ignored by git).
- Keep fixture length short (about 2-6 seconds) to reduce test runtime and flakiness.

### Optional env vars

- `MINGLE_TEST_WS_URL` (default: `ws://127.0.0.1:3001`)
- `MINGLE_TEST_API_BASE_URL` (default: `http://127.0.0.1:3000`)
- `MINGLE_TEST_EXPECTED_PHRASE` (asserts recognized text contains this phrase)

