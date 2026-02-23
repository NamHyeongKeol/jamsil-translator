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

@MainActor
final class AudioCaptureService {
    private let audioEngine = AVAudioEngine()
    private var currentSampleRate: Double = 16_000

    var sampleRate: Double {
        currentSampleRate
    }

    func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    continuation.resume(returning: granted)
                }
            }
        }
    }

    func start(
        onAudioChunk: @escaping (String) -> Void,
        onRmsLevel: @escaping (Float) -> Void
    ) throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
            )
            try session.setActive(true)
        } catch {
            throw AudioCaptureError.failedToStartEngine(error.localizedDescription)
        }

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
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

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: captureFormat) { buffer, _ in
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            if frameLength == 0 { return }

            let samples = UnsafeBufferPointer(start: channelData, count: frameLength)
            let pcmData = Self.floatBufferToInt16PCM(samples)
            let base64 = pcmData.base64EncodedString()
            onAudioChunk(base64)

            let rms = Self.rms(from: samples)
            onRmsLevel(rms)
        }

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
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            // Ignore deactivation failures.
        }
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
