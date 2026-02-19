import AVFoundation
import Foundation
import React

@objc(NativeTTSModule)
class NativeTTSModule: RCTEventEmitter, AVAudioPlayerDelegate {
    private var audioPlayer: AVAudioPlayer?
    private var hasListeners = false
    private var ttsSessionTokenAcquired = false

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

    private func releaseTtsSessionTokenIfNeeded() {
        if !ttsSessionTokenAcquired { return }
        MingleAudioSessionCoordinator.shared.releaseTTS()
        ttsSessionTokenAcquired = false
        if MingleAudioSessionCoordinator.shared.shouldDeactivateAudioSession() {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                // Keep shutdown resilient even if AVAudioSession deactivation fails.
            }
        }
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

        NSLog("[NativeTTSModule] play audioBytes=%d", audioData.count)

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            self.audioPlayer?.stop()
            self.audioPlayer = nil
            self.releaseTtsSessionTokenIfNeeded()

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
                NSLog("[NativeTTSModule] playing duration=%.2f", player.duration)
                resolve(["ok": true])
            } catch {
                NSLog("[NativeTTSModule] play failed: %@", error.localizedDescription)
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
            if let player = self.audioPlayer, player.isPlaying {
                player.stop()
            }
            self.audioPlayer = nil
            self.releaseTtsSessionTokenIfNeeded()
            if wasPlaying {
                NSLog("[NativeTTSModule] stopped")
                self.emit("ttsPlaybackStopped", payload: [:])
            }
            resolve(["ok": true])
        }
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        NSLog("[NativeTTSModule] didFinishPlaying success=%d", flag ? 1 : 0)
        audioPlayer = nil
        releaseTtsSessionTokenIfNeeded()
        emit("ttsPlaybackFinished", payload: ["success": flag])
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        NSLog("[NativeTTSModule] decodeError: %@", error?.localizedDescription ?? "unknown")
        audioPlayer = nil
        releaseTtsSessionTokenIfNeeded()
        emit("ttsError", payload: ["message": error?.localizedDescription ?? "decode_error"])
    }
}
