import AVFoundation
import Foundation

enum AudioCaptureError: LocalizedError {
    case inputNodeUnavailable
    case failedToStartEngine(String)

    var errorDescription: String? {
        switch self {
        case .inputNodeUnavailable:
            return "Audio input is unavailable"
        case let .failedToStartEngine(message):
            return "Failed to start audio engine: \(message)"
        }
    }
}

final class AudioCaptureService: @unchecked Sendable {
    private let audioEngine = AVAudioEngine()
    private var currentSampleRate: Double = 16_000
    private var currentOnAudioChunk: (@Sendable (String) -> Void)?
    private var currentOnRmsLevel: (@Sendable (Float) -> Void)?
    private var tapInstalled = false

    var sampleRate: Double {
        currentSampleRate
    }

    func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start(
        aecEnabled: Bool,
        onAudioChunk: @Sendable @escaping (String) -> Void,
        onRmsLevel: @Sendable @escaping (Float) -> Void
    ) throws {
        currentOnAudioChunk = onAudioChunk
        currentOnRmsLevel = onRmsLevel

        try configureAudioSession(aecEnabled: aecEnabled)

        let inputNode = audioEngine.inputNode
        if #available(iOS 17.0, *) {
            try? inputNode.setVoiceProcessingEnabled(aecEnabled)
        }
        let inputFormat = inputNode.inputFormat(forBus: 0)
        currentSampleRate = inputFormat.sampleRate

        let monoFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: inputFormat.sampleRate,
            channels: 1,
            interleaved: false
        )

        guard let captureFormat = monoFormat else {
            throw AudioCaptureError.inputNodeUnavailable
        }

        safelyRemoveTap()
        installTap(format: captureFormat)

        do {
            if !audioEngine.isRunning {
                audioEngine.prepare()
                try audioEngine.start()
            }
        } catch {
            throw AudioCaptureError.failedToStartEngine(error.localizedDescription)
        }
    }

    func stop() {
        safelyRemoveTap()
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        currentOnAudioChunk = nil
        currentOnRmsLevel = nil

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            // Ignore deactivation failures.
        }
    }

    /// Hot-swap AEC mode mid-session: reconfigure audio session, reset engine,
    /// reinstall tap, and restart — matching the RN NativeSTTModule.setAec pattern.
    func updateAecMode(enabled: Bool) {
        guard audioEngine.isRunning else {
            // Not running — just update session mode for next start().
            try? AVAudioSession.sharedInstance().setMode(enabled ? .voiceChat : .default)
            return
        }

        // 1. Reconfigure audio session with new mode
        do {
            try configureAudioSession(aecEnabled: enabled)
        } catch {
            // Continue anyway — the old mode might still work.
        }

        // 2. Remove tap, stop engine, reset (clears AEC calibration state)
        safelyRemoveTap()
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.reset()

        // 3. Update voice processing flag (iOS 17+)
        let inputNode = audioEngine.inputNode
        if #available(iOS 17.0, *) {
            try? inputNode.setVoiceProcessingEnabled(enabled)
        }

        // 4. Reinstall tap with fresh format + restart engine
        let inputFormat = inputNode.inputFormat(forBus: 0)
        currentSampleRate = inputFormat.sampleRate

        let monoFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: inputFormat.sampleRate,
            channels: 1,
            interleaved: false
        )

        if let captureFormat = monoFormat {
            installTap(format: captureFormat)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            // Engine restart failed — recording will be broken.
        }
    }

    // MARK: - Private

    private func configureAudioSession(aecEnabled: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: aecEnabled ? .voiceChat : .default,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        )
        try session.setActive(true)
    }

    private func installTap(format: AVAudioFormat) {
        guard let onChunk = currentOnAudioChunk, let onRms = currentOnRmsLevel else { return }
        audioEngine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            if frameLength == 0 { return }

            let samples = UnsafeBufferPointer(start: channelData, count: frameLength)
            let pcmData = Self.floatBufferToInt16PCM(samples)
            let base64 = pcmData.base64EncodedString()
            onChunk(base64)

            let rms = Self.rms(from: samples)
            onRms(rms)
        }
        tapInstalled = true
    }

    private func safelyRemoveTap() {
        guard tapInstalled else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    private static func floatBufferToInt16PCM(_ samples: UnsafeBufferPointer<Float>) -> Data {
        var pcm = [Int16]()
        pcm.reserveCapacity(samples.count)

        for sample in samples {
            let clamped = max(-1.0, min(1.0, sample))
            let scaled: Float
            if clamped < 0 {
                scaled = clamped * 32768.0
            } else {
                scaled = clamped * 32767.0
            }
            pcm.append(Int16(scaled))
        }

        return pcm.withUnsafeBufferPointer { buffer in
            Data(buffer: buffer)
        }
    }

    private static func rms(from samples: UnsafeBufferPointer<Float>) -> Float {
        if samples.isEmpty { return 0 }
        let sumSquares = samples.reduce(0) { partial, value in
            partial + (value * value)
        }
        return sqrt(sumSquares / Float(samples.count))
    }
}
