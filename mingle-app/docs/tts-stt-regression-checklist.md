# TTS/STT Regression Checklist

## Goal
- Ensure STT stop and TTS stop remain separate policies.
- Prevent TTS state lock after STT stop while playback is active.

## Stop Policy
- STT stop must not call `native_tts_stop`.
- `native_tts_stop` is only allowed for:
  - mute/sound-off action
  - force reset path
  - component unmount/app exit

## Manual Scenarios
1. Start STT, trigger TTS, then stop STT while TTS is playing.
   - Expected: current TTS finishes naturally.
   - Expected: speaking effect clears when playback ends.
2. After scenario 1, start STT again and trigger new TTS.
   - Expected: new TTS plays normally (no stuck state).
3. Toggle mute while TTS is playing.
   - Expected: current TTS stops immediately and queue is cleared.
4. Toggle sound back on, then trigger STT/TTS again.
   - Expected: playback resumes with new utterances.
5. Send app to background and return during/after playback.
   - Expected: no permanent `isTtsProcessing` lock.

## Native Event Validation
- Confirm `tts_ended`, `tts_stopped`, `tts_error` events resolve active playback by `playbackId` first.
- Confirm stale events do not reset the current playback state.
