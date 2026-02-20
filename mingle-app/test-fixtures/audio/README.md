## Live STT Audio Fixtures

`pnpm test` now includes a live integration test that streams a WAV file to the local STT WebSocket server.

Default fixture directory:

- `test-fixtures/audio/fixtures/`
- `test-fixtures/audio/local/` (local-only, git ignored)

How fixture selection works:

- All files under both fixture directories are scanned.
- `.wav` files are parsed directly (PCM 16-bit mono required).
- `.m4a` and other supported formats are transcoded via `ffmpeg` (fallback: macOS `afconvert`).
- Unsupported extensions or failed transcodes are skipped with a warning.
- At least one valid file must exist, or the live test fails.

You can override fixture source with:

- `MINGLE_TEST_AUDIO_FIXTURE=/absolute/path/to/fixture.wav`
- `MINGLE_TEST_AUDIO_FIXTURE_DIR=/absolute/path/to/fixtures-dir`

Required fixture format:

- Direct WAV input: RIFF/WAVE, PCM 16-bit, mono (1 channel)
- Transcoded inputs (e.g. `.m4a`) are converted to the same format during test

### Git policy (recommended)

- Commit one short, sanitized baseline fixture under `test-fixtures/audio/fixtures/` for team reproducibility.
- Put personal or sensitive recordings under `test-fixtures/audio/local/` (ignored by git).
- Keep fixture length short (about 2-6 seconds) to reduce test runtime and flakiness.

### Optional env vars

- `MINGLE_TEST_WS_URL` (default: `ws://127.0.0.1:3001`)
- `MINGLE_TEST_API_BASE_URL` (default: `http://127.0.0.1:3000`)
- `MINGLE_TEST_EXPECTED_PHRASE` (asserts recognized text contains this phrase)
