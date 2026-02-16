import AVFoundation
import Foundation
import React

@objc(NativeSTTModule)
class NativeSTTModule: RCTEventEmitter {
    private let audioEngine = AVAudioEngine()
    private let wsQueue = DispatchQueue(label: "NativeSTTModule.wsQueue")

    private var webSocketSession: URLSession?
    private var socketTask: URLSessionWebSocketTask?
    private var hasInputTap = false
    private var isRunning = false
    private var hasListeners = false
    private var audioObserversInstalled = false
    private var isRestartingAudio = false
    private var lastAudioRestartAt = Date.distantPast

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        ["status", "message", "error", "close"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    deinit {
        stopAndCleanup(reason: nil)
    }

    private func configureAudioSession() throws {
        let audioSession = AVAudioSession.sharedInstance()
        // Keep full-duplex (record + playback) but avoid voiceChat processing that
        // pushes output into low "call-like" playback on iOS.
        try audioSession.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        )
        try? audioSession.setPreferredSampleRate(48_000)
        try? audioSession.setPreferredIOBufferDuration(0.02)
        try audioSession.setActive(true, options: [])
    }

    private func installAudioObserversIfNeeded() {
        if audioObserversInstalled {
            return
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleAudioSessionInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(handleAudioSessionRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(handleMediaServicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        center.addObserver(self, selector: #selector(handleAudioEngineConfigurationChange(_:)), name: .AVAudioEngineConfigurationChange, object: audioEngine)
        audioObserversInstalled = true
    }

    private func removeAudioObserversIfNeeded() {
        if !audioObserversInstalled {
            return
        }
        let center = NotificationCenter.default
        center.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        center.removeObserver(self, name: AVAudioSession.routeChangeNotification, object: nil)
        center.removeObserver(self, name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        center.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: audioEngine)
        audioObserversInstalled = false
    }

    private func emit(_ event: String, payload: [String: Any]) {
        guard hasListeners else { return }
        sendEvent(withName: event, body: payload)
    }

    private func emitError(_ message: String) {
        NSLog("[NativeSTTModule] error=%@", message)
        emit("error", payload: ["message": message])
    }

    private func emitStatus(_ status: String) {
        emit("status", payload: ["status": status])
    }

    private func emitMessage(raw: String) {
        emit("message", payload: ["raw": raw])
    }

    private func emitClose(_ reason: String) {
        emit("close", payload: ["reason": reason])
    }

    private func removeTapIfNeeded() {
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
    }

    private func installInputTap(format: AVAudioFormat) {
        let inputNode = audioEngine.inputNode
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            guard self.isRunning else { return }
            guard let chunkBase64 = self.encodePcmBase64(buffer) else { return }

            self.wsQueue.async { [weak self] in
                self?.sendJson([
                    "type": "audio_chunk",
                    "data": [
                        "chunk": chunkBase64,
                    ],
                ])
            }
        }
        hasInputTap = true
    }

    private func restartAudioCapture(reason: String) {
        guard isRunning else { return }
        let now = Date()
        if isRestartingAudio {
            return
        }
        if now.timeIntervalSince(lastAudioRestartAt) < 0.5 {
            return
        }

        isRestartingAudio = true
        lastAudioRestartAt = now
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.isRunning else { return }
            defer {
                self.isRestartingAudio = false
            }

            do {
                try self.configureAudioSession()
            } catch {
                self.emitError("audio_reconfigure_failed(\(reason)): \(error.localizedDescription)")
                return
            }

            self.removeTapIfNeeded()

            let inputNode = self.audioEngine.inputNode
            if #available(iOS 17.0, *) { try? inputNode.setVoiceProcessingEnabled(true) }
            let inputFormat = inputNode.inputFormat(forBus: 0)
            self.installInputTap(format: inputFormat)

            if self.audioEngine.isRunning {
                self.audioEngine.stop()
            }

            do {
                self.audioEngine.prepare()
                try self.audioEngine.start()
                self.emitStatus("running")
                NSLog("[NativeSTTModule] audio restarted reason=%@", reason)
            } catch {
                self.emitError("audio_restart_failed(\(reason)): \(error.localizedDescription)")
            }
        }
    }

    @objc
    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard isRunning else { return }
        guard
            let userInfo = notification.userInfo,
            let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else {
            return
        }

        if type == .began {
            emitStatus("interrupted")
            return
        }

        restartAudioCapture(reason: "interruption_ended")
    }

    @objc
    private func handleAudioSessionRouteChange(_ notification: Notification) {
        guard isRunning else { return }
        guard
            let userInfo = notification.userInfo,
            let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else {
            return
        }
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable, .noSuitableRouteForCategory, .wakeFromSleep:
            restartAudioCapture(reason: "route_change_\(reasonValue)")
        default:
            break
        }
    }

    @objc
    private func handleMediaServicesReset(_ notification: Notification) {
        guard isRunning else { return }
        restartAudioCapture(reason: "media_services_reset")
    }

    @objc
    private func handleAudioEngineConfigurationChange(_ notification: Notification) {
        guard isRunning else { return }
        restartAudioCapture(reason: "engine_configuration_change")
    }

    private func stopAndCleanup(reason: String?) {
        isRunning = false
        removeAudioObserversIfNeeded()
        removeTapIfNeeded()

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // Keep shutdown resilient even if AVAudioSession deactivation fails.
        }

        socketTask?.cancel(with: .goingAway, reason: nil)
        socketTask = nil

        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil

        if let reason {
            emitClose(reason)
        }
    }

    private func sendJson(_ payload: [String: Any]) {
        guard let task = socketTask, isRunning else { return }

        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            guard let text = String(data: data, encoding: .utf8) else {
                emitError("json_encoding_failed")
                return
            }

            task.send(.string(text)) { [weak self] error in
                guard let self else { return }
                if let error, self.isRunning {
                    self.emitError("ws_send_failed: \(error.localizedDescription)")
                }
            }
        } catch {
            emitError("json_serialize_failed: \(error.localizedDescription)")
        }
    }

    private func receiveLoop() {
        guard let task = socketTask, isRunning else { return }

        task.receive { [weak self] result in
            guard let self else { return }
            guard self.isRunning else { return }

            switch result {
            case .failure(let error):
                self.emitError("ws_receive_failed: \(error.localizedDescription)")
                self.stopAndCleanup(reason: "receive_failed")
            case .success(let message):
                switch message {
                case .string(let text):
                    self.emitMessage(raw: text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.emitMessage(raw: text)
                    }
                @unknown default:
                    break
                }
                self.receiveLoop()
            }
        }
    }

    private func encodePcmBase64(_ buffer: AVAudioPCMBuffer) -> String? {
        guard let channelData = buffer.floatChannelData?[0] else { return nil }

        let frameLength = Int(buffer.frameLength)
        if frameLength == 0 {
            return nil
        }

        var pcmData = Data(capacity: frameLength * MemoryLayout<Int16>.size)

        for index in 0 ..< frameLength {
            let sample = max(-1.0, min(1.0, channelData[index]))
            var intSample = Int16(sample < 0 ? sample * 32768.0 : sample * 32767.0)
            withUnsafeBytes(of: &intSample) { bytes in
                pcmData.append(contentsOf: bytes)
            }
        }

        return pcmData.base64EncodedString()
    }

    private func startSession(
        wsUrl: URL,
        wsUrlString: String,
        languages: [String],
        sttModel: String,
        langHintsStrict: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            try configureAudioSession()
        } catch {
            reject("audio_session", "Failed to configure AVAudioSession", error)
            return
        }

        installAudioObserversIfNeeded()
        removeTapIfNeeded()
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        let inputNode = audioEngine.inputNode
        // Enable Apple voice-processing (AEC + noise suppression) on the
        // input without switching to .voiceChat mode, which would lower
        // the playback volume.  Must be set before reading inputFormat
        // because enabling VP may change the hardware format.
        if #available(iOS 17.0, *) { try? inputNode.setVoiceProcessingEnabled(true) }
        let inputFormat = inputNode.inputFormat(forBus: 0)
        let sampleRate = Int(inputFormat.sampleRate.rounded())

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration)
        let task = session.webSocketTask(with: wsUrl)

        webSocketSession = session
        socketTask = task
        isRunning = true

        emitStatus("connecting")
        task.resume()
        receiveLoop()

        installInputTap(format: inputFormat)

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            stopAndCleanup(reason: nil)
            reject("audio_engine", "Failed to start AVAudioEngine", error)
            return
        }

        sendJson([
            "sample_rate": sampleRate,
            "languages": languages,
            "stt_model": sttModel,
            "lang_hints_strict": langHintsStrict,
        ])

        emitStatus("running")
        NSLog("[NativeSTTModule] started sampleRate=%d ws=%@", sampleRate, wsUrlString)
        resolve([
            "sampleRate": sampleRate,
        ])
    }

    @objc(start:resolver:rejecter:)
    func start(
        _ options: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if isRunning {
            reject("already_running", "native_stt_already_running", nil)
            return
        }

        guard let wsUrlString = options["wsUrl"] as? String,
              let wsUrl = URL(string: wsUrlString)
        else {
            reject("invalid_ws_url", "Invalid wsUrl", nil)
            return
        }

        let languages = options["languages"] as? [String] ?? []
        let sttModel = options["sttModel"] as? String ?? "soniox"
        let langHintsStrict = options["langHintsStrict"] as? Bool ?? true

        let audioSession = AVAudioSession.sharedInstance()
        switch audioSession.recordPermission {
        case .granted:
            startSession(
                wsUrl: wsUrl,
                wsUrlString: wsUrlString,
                languages: languages,
                sttModel: sttModel,
                langHintsStrict: langHintsStrict,
                resolve: resolve,
                reject: reject
            )
        case .denied:
            emitError("mic_permission_denied")
            reject("mic_permission", "Microphone permission denied", nil)
        case .undetermined:
            audioSession.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.startSession(
                            wsUrl: wsUrl,
                            wsUrlString: wsUrlString,
                            languages: languages,
                            sttModel: sttModel,
                            langHintsStrict: langHintsStrict,
                            resolve: resolve,
                            reject: reject
                        )
                        return
                    }

                    self.emitError("mic_permission_denied_after_prompt")
                    reject("mic_permission", "Microphone permission denied", nil)
                }
            }
        @unknown default:
            emitError("mic_permission_unknown_state")
            reject("mic_permission", "Unknown microphone permission state", nil)
        }
    }

    @objc(stop:resolver:rejecter:)
    func stop(
        _ options: NSDictionary?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        let pendingText = options?["pendingText"] as? String ?? ""
        let pendingLanguage = options?["pendingLanguage"] as? String ?? "unknown"

        if isRunning {
            sendJson([
                "type": "stop_recording",
                "data": [
                    "pending_text": pendingText,
                    "pending_language": pendingLanguage,
                ],
            ])
        }

        stopAndCleanup(reason: "stopped")
        emitStatus("stopped")
        NSLog("[NativeSTTModule] stopped")
        resolve(["ok": true])
    }
}
