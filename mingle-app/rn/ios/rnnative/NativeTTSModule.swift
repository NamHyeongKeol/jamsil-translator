import AVFoundation
import Foundation
import React

@objc(NativeTTSModule)
class NativeTTSModule: RCTEventEmitter, AVAudioPlayerDelegate {
    private var audioPlayer: AVAudioPlayer?
    private var hasListeners = false
    private var ttsSessionTokenAcquired = false
    private var currentPlaybackId: String?
    private var currentUtteranceId: String?

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        ["ttsPlaybackFinished", "ttsPlaybackStopped", "ttsError"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    deinit {
        audioPlayer?.stop()
        audioPlayer = nil
        releaseTtsSessionTokenIfNeeded()
    }

    private func emit(_ event: String, payload: [String: Any]) {
        guard hasListeners else { return }
        sendEvent(withName: event, body: payload)
    }

    private func acquireTtsSessionTokenIfNeeded() {
        if ttsSessionTokenAcquired { return }
        MingleAudioSessionCoordinator.shared.acquireTTS()
        ttsSessionTokenAcquired = true
    }

    private func clearCurrentPlaybackIdentity() {
        currentPlaybackId = nil
        currentUtteranceId = nil
    }

    private func playbackPayload(base: [String: Any] = [:]) -> [String: Any] {
        var payload = base
        if let playbackId = currentPlaybackId, !playbackId.isEmpty {
            payload["playbackId"] = playbackId
        }
        if let utteranceId = currentUtteranceId, !utteranceId.isEmpty {
            payload["utteranceId"] = utteranceId
        }
        return payload
    }

    private func releaseTtsSessionTokenIfNeeded() {
        if !ttsSessionTokenAcquired { return }
        MingleAudioSessionCoordinator.shared.releaseTTS()
        ttsSessionTokenAcquired = false
        MingleAudioSessionCoordinator.shared.scheduleDeactivateAudioSessionIfIdle(
            trigger: "tts_release"
        )
    }

    @objc(play:resolver:rejecter:)
    func play(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let audioBase64 = options["audioBase64"] as? String,
              let audioData = Data(base64Encoded: audioBase64)
        else {
            reject("decode_error", "Failed to decode base64 audio data", nil)
            return
        }
        let rawPlaybackId = (options["playbackId"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rawUtteranceId = (options["utteranceId"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let playbackId = rawPlaybackId.isEmpty
            ? (rawUtteranceId.isEmpty ? UUID().uuidString : rawUtteranceId)
            : rawPlaybackId

        NSLog("[NativeTTSModule] play playbackId=%@ utteranceId=%@ audioBytes=%d", playbackId, rawUtteranceId, audioData.count)

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            self.audioPlayer?.stop()
            self.audioPlayer = nil
            self.releaseTtsSessionTokenIfNeeded()
            self.clearCurrentPlaybackIdentity()
            self.currentPlaybackId = playbackId
            self.currentUtteranceId = rawUtteranceId.isEmpty ? nil : rawUtteranceId

            // Ensure audio session is active for playback.
            // NativeSTTModule normally keeps it active, but if STT stopped
            // before all TTS items played we still need a valid session.
            let session = AVAudioSession.sharedInstance()
            if session.category != .playAndRecord {
                do {
                    try session.setCategory(
                        .playAndRecord,
                        mode: .default,
                        options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
                    )
                    try session.setActive(true, options: [])
                } catch {
                    NSLog("[NativeTTSModule] session fallback failed: %@", error.localizedDescription)
                }
            }
            do {
                try session.setActive(true, options: [])
            } catch {
                NSLog("[NativeTTSModule] setActive(true) failed: %@", error.localizedDescription)
            }

            do {
                let player = try AVAudioPlayer(data: audioData)
                player.delegate = self
                player.prepareToPlay()
                if !player.play() {
                    throw NSError(
                        domain: "NativeTTSModule",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "AVAudioPlayer failed to start playback"]
                    )
                }
                self.audioPlayer = player
                self.acquireTtsSessionTokenIfNeeded()
                NSLog("[NativeTTSModule] playing playbackId=%@ duration=%.2f", playbackId, player.duration)
                resolve(["ok": true])
            } catch {
                NSLog("[NativeTTSModule] play failed: %@", error.localizedDescription)
                self.clearCurrentPlaybackIdentity()
                self.releaseTtsSessionTokenIfNeeded()
                reject("playback_error", "Failed to play audio: \(error.localizedDescription)", error)
            }
        }
    }

    @objc(stop:rejecter:)
    func stop(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let wasPlaying = self.audioPlayer?.isPlaying == true
            let stoppedPayload = self.playbackPayload()
            if let player = self.audioPlayer, player.isPlaying {
                player.stop()
            }
            self.audioPlayer = nil
            self.clearCurrentPlaybackIdentity()
            self.releaseTtsSessionTokenIfNeeded()
            if wasPlaying {
                NSLog("[NativeTTSModule] stopped playbackId=%@", stoppedPayload["playbackId"] as? String ?? "")
                self.emit("ttsPlaybackStopped", payload: stoppedPayload)
            }
            resolve(["ok": true])
        }
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let payload = playbackPayload(base: ["success": flag])
        NSLog(
            "[NativeTTSModule] didFinishPlaying playbackId=%@ success=%d",
            payload["playbackId"] as? String ?? "",
            flag ? 1 : 0
        )
        audioPlayer = nil
        clearCurrentPlaybackIdentity()
        releaseTtsSessionTokenIfNeeded()
        emit("ttsPlaybackFinished", payload: payload)
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let payload = playbackPayload(base: ["message": error?.localizedDescription ?? "decode_error"])
        NSLog(
            "[NativeTTSModule] decodeError playbackId=%@ message=%@",
            payload["playbackId"] as? String ?? "",
            error?.localizedDescription ?? "unknown"
        )
        audioPlayer = nil
        clearCurrentPlaybackIdentity()
        releaseTtsSessionTokenIfNeeded()
        emit("ttsError", payload: payload)
    }
}
