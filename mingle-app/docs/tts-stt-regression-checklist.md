# TTS/STT Regression Checklist

## Goal
- Ensure STT stop and TTS stop remain separate policies.
- Prevent TTS state lock after STT stop while playback is active.
- Reduce end-of-playback pop noise after STT is already stopped.

## Stop Policy
- STT stop must not call `native_tts_stop`.
- `native_tts_stop` is only allowed for:
  - mute/sound-off action
  - force reset path
  - component unmount/app exit
- STT restart is user-action only. Audio session logic must not auto-start STT.

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

## M5 Audio Session Validation
- Confirm iOS native audio session deactivation uses a short grace delay.
- Confirm new STT/TTS activity during grace cancels deactivation.
- Confirm this cancellation does not trigger any automatic STT start.

## M6 Route-Aware Policy Validation
- Built-in speaker/receiver path:
  - Expected deactivation delay: `320ms`
  - Expected deactivation option: `none`
- Wired headset/USB path:
  - Expected deactivation delay: `180ms`
  - Expected deactivation option: `none`
- Bluetooth/AirPlay/Car path:
  - Expected deactivation delay: `220ms`
  - Expected deactivation option: `notifyOthersOnDeactivation`
- Confirm native logs contain `schedule deactivate` and `deactivated` with
  the same `trigger`, `routeProfile`, and `options` for each scenario.
- Confirm STT remains stopped after any deactivation cancellation unless the
  user explicitly presses the STT start control again.
