import AVFoundation
import Foundation
import React

final class MingleAudioSessionCoordinator {
    static let shared = MingleAudioSessionCoordinator()

    private enum OutputRouteProfile: String {
        case speaker
        case receiver
        case wired
        case bluetooth
        case airplay
        case car
        case unknown
    }

    private struct DeactivationPolicy {
        let delayMs: Int
        let options: AVAudioSession.SetActiveOptions
        let outputProfile: OutputRouteProfile
        let optionsLabel: String
    }

    private let lock = NSLock()
    private var sttOwners: Int = 0
    private var ttsOwners: Int = 0
    private var pendingDeactivationWorkItem: DispatchWorkItem?

    private init() {}

    private func withLock<T>(_ block: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return block()
    }

    private func cancelPendingDeactivationLocked(reason: String) {
        if pendingDeactivationWorkItem != nil {
            NSLog("[MingleAudioSessionCoordinator] cancel pending deactivate reason=%@", reason)
        }
        pendingDeactivationWorkItem?.cancel()
        pendingDeactivationWorkItem = nil
    }

    private func resolveOutputRouteProfile() -> OutputRouteProfile {
        let route = AVAudioSession.sharedInstance().currentRoute
        for output in route.outputs {
            switch output.portType {
            case .builtInSpeaker:
                return .speaker
            case .builtInReceiver:
                return .receiver
            case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
                return .bluetooth
            case .headphones, .headsetMic, .lineOut, .usbAudio:
                return .wired
            case .airPlay:
                return .airplay
            case .carAudio:
                return .car
            default:
                continue
            }
        }
        return .unknown
    }

    private func resolveOutputRouteLabel() -> String {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        if outputs.isEmpty {
            return "none"
        }
        return outputs
            .map { "\($0.portName)(\($0.portType.rawValue))" }
            .joined(separator: ",")
    }

    private func resolveOptionsLabel(_ options: AVAudioSession.SetActiveOptions) -> String {
        if options.contains(.notifyOthersOnDeactivation) {
            return "notifyOthersOnDeactivation"
        }
        return "none"
    }

    private func resolveDeactivationPolicy(delayMsOverride: Int?) -> DeactivationPolicy {
        let outputProfile = resolveOutputRouteProfile()
        let defaultDelayMs: Int
        let options: AVAudioSession.SetActiveOptions

        switch outputProfile {
        case .speaker, .receiver:
            // Keep a slightly longer tail on built-in outputs to reduce click/pop.
            defaultDelayMs = 320
            options = []
        case .wired:
            defaultDelayMs = 180
            options = []
        case .bluetooth, .airplay, .car:
            defaultDelayMs = 220
            options = [.notifyOthersOnDeactivation]
        case .unknown:
            defaultDelayMs = 260
            options = []
        }

        let delayMs = max(0, delayMsOverride ?? defaultDelayMs)
        return DeactivationPolicy(
            delayMs: delayMs,
            options: options,
            outputProfile: outputProfile,
            optionsLabel: resolveOptionsLabel(options)
        )
    }

    func acquireSTT() {
        withLock {
            cancelPendingDeactivationLocked(reason: "acquire_stt")
            sttOwners += 1
        }
    }

    func releaseSTT() {
        withLock {
            if sttOwners > 0 {
                sttOwners -= 1
            }
        }
    }

    func acquireTTS() {
        withLock {
            cancelPendingDeactivationLocked(reason: "acquire_tts")
            ttsOwners += 1
        }
    }

    func releaseTTS() {
        withLock {
            if ttsOwners > 0 {
                ttsOwners -= 1
            }
        }
    }

    func scheduleDeactivateAudioSessionIfIdle(trigger: String, delayMs: Int? = nil) {
        var workItemToSchedule: DispatchWorkItem?
        let policy = resolveDeactivationPolicy(delayMsOverride: delayMs)
        let routeLabel = resolveOutputRouteLabel()

        withLock {
            cancelPendingDeactivationLocked(reason: "schedule_deactivate_\(trigger)")
            if sttOwners != 0 || ttsOwners != 0 {
                NSLog(
                    "[MingleAudioSessionCoordinator] skip deactivate trigger=%@ owners stt=%d tts=%d routeProfile=%@ outputs=[%@]",
                    trigger,
                    sttOwners,
                    ttsOwners,
                    policy.outputProfile.rawValue,
                    routeLabel
                )
                return
            }

            let workItem = DispatchWorkItem { [weak self] in
                guard let self else { return }
                let shouldDeactivate = self.withLock {
                    self.pendingDeactivationWorkItem = nil
                    return self.sttOwners == 0 && self.ttsOwners == 0
                }
                guard shouldDeactivate else { return }
                do {
                    try AVAudioSession.sharedInstance().setActive(false, options: policy.options)
                    NSLog(
                        "[MingleAudioSessionCoordinator] deactivated trigger=%@ delayMs=%d routeProfile=%@ options=%@ outputs=[%@]",
                        trigger,
                        policy.delayMs,
                        policy.outputProfile.rawValue,
                        policy.optionsLabel,
                        routeLabel
                    )
                } catch {
                    NSLog(
                        "[MingleAudioSessionCoordinator] deactivate failed trigger=%@ delayMs=%d routeProfile=%@ options=%@ error=%@",
                        trigger,
                        policy.delayMs,
                        policy.outputProfile.rawValue,
                        policy.optionsLabel,
                        error.localizedDescription
                    )
                }
            }
            pendingDeactivationWorkItem = workItem
            workItemToSchedule = workItem
            NSLog(
                "[MingleAudioSessionCoordinator] schedule deactivate trigger=%@ delayMs=%d routeProfile=%@ options=%@ outputs=[%@]",
                trigger,
                policy.delayMs,
                policy.outputProfile.rawValue,
                policy.optionsLabel,
                routeLabel
            )
        }

        guard let workItemToSchedule else { return }
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(policy.delayMs),
            execute: workItemToSchedule
        )
    }

    func snapshot() -> (stt: Int, tts: Int) {
        return withLock { (stt: sttOwners, tts: ttsOwners) }
    }
}

@objc(NativeSTTModule)
class NativeSTTModule: RCTEventEmitter {
    private let audioEngine = AVAudioEngine()
    private let wsQueue = DispatchQueue(label: "NativeSTTModule.wsQueue")

    private var webSocketSession: URLSession?
    private var socketTask: URLSessionWebSocketTask?
    private var hasInputTap = false
    private var isRunning = false
    private var sttSessionTokenAcquired = false
    private var isAecEnabled = false
    private var lastAppliedAec: Bool? = nil
    private var hasListeners = false
    private var audioObserversInstalled = false
    private var isRestartingAudio = false
    private var lastAudioRestartAt = Date.distantPast
    private var audioChunkCount: Int64 = 0
    private var wsMessageCount: Int64 = 0
    private var wsPingTimer: DispatchSourceTimer?
    private var healthCheckTimer: DispatchSourceTimer?
    private var lastChunkCountSnapshot: Int64 = 0

    override static func requiresMainQueueSetup() -> Bool {
        false
    }

    private static func readRuntimeConfigValue(_ key: String) -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return ""
        }
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 {
            value = String(value.dropFirst().dropLast())
        }
        value = value.replacingOccurrences(of: "\\/", with: "/")
        value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty || value.hasPrefix("$(") {
            return ""
        }
        return value
    }

    private static func readRuntimeConfigURL(
        schemeKey: String,
        hostKey: String,
        legacyKey: String
    ) -> String {
        let scheme = Self.readRuntimeConfigValue(schemeKey)
        let host = Self.readRuntimeConfigValue(hostKey)
        if !scheme.isEmpty && !host.isEmpty {
            return "\(scheme)://\(host)"
        }
        return Self.readRuntimeConfigValue(legacyKey)
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        return [
            "runtimeConfig": [
                "webAppBaseUrl": Self.readRuntimeConfigURL(
                    schemeKey: "MingleWebAppScheme",
                    hostKey: "MingleWebAppHost",
                    legacyKey: "MingleWebAppBaseURL"
                ),
                "defaultWsUrl": Self.readRuntimeConfigURL(
                    schemeKey: "MingleDefaultWsScheme",
                    hostKey: "MingleDefaultWsHost",
                    legacyKey: "MingleDefaultWsURL"
                ),
            ],
        ]
    }

    @objc(getRuntimeConfig:rejecter:)
    func getRuntimeConfig(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        resolve([
            "webAppBaseUrl": Self.readRuntimeConfigURL(
                schemeKey: "MingleWebAppScheme",
                hostKey: "MingleWebAppHost",
                legacyKey: "MingleWebAppBaseURL"
            ),
            "defaultWsUrl": Self.readRuntimeConfigURL(
                schemeKey: "MingleDefaultWsScheme",
                hostKey: "MingleDefaultWsHost",
                legacyKey: "MingleDefaultWsURL"
            ),
        ])
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
        NSLog("[NativeSTTModule] configureAudioSession category=%@ mode=%@ sampleRate=%.0f",
              audioSession.category.rawValue, audioSession.mode.rawValue, audioSession.sampleRate)
        // Keep full-duplex (record + playback) but avoid voiceChat processing that
        // pushes output into low "call-like" playback on iOS.
        try audioSession.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP, .mixWithOthers]
        )
        try? audioSession.setPreferredSampleRate(48_000)
        try? audioSession.setPreferredIOBufferDuration(0.02)
        try audioSession.setActive(true, options: [])
        NSLog("[NativeSTTModule] audioSession active sampleRate=%.0f ioBufferDuration=%.4f",
              audioSession.sampleRate, audioSession.ioBufferDuration)
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
        NSLog("[NativeSTTModule] installTap format=%@ channels=%d sampleRate=%.0f",
              format.description, format.channelCount, format.sampleRate)
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            guard self.isRunning else { return }
            guard let chunkBase64 = self.encodePcmBase64(buffer) else { return }

            self.audioChunkCount += 1
            let count = self.audioChunkCount
            if count == 1 || count % 200 == 0 {
                NSLog("[NativeSTTModule] audioChunk #%lld frames=%d engineRunning=%d",
                      count, buffer.frameLength, self.audioEngine.isRunning ? 1 : 0)
            }

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
            if #available(iOS 17.0, *) { try? inputNode.setVoiceProcessingEnabled(self.isAecEnabled) }
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
        NSLog("[NativeSTTModule] stopAndCleanup reason=%@ chunks=%lld wsMessages=%lld",
              reason ?? "nil", audioChunkCount, wsMessageCount)
        isRunning = false
        stopWsPing()
        stopHealthCheck()
        removeAudioObserversIfNeeded()
        removeTapIfNeeded()

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if sttSessionTokenAcquired {
            MingleAudioSessionCoordinator.shared.releaseSTT()
            sttSessionTokenAcquired = false
        }
        MingleAudioSessionCoordinator.shared.scheduleDeactivateAudioSessionIfIdle(
            trigger: "stt_stop_cleanup"
        )
        let owners = MingleAudioSessionCoordinator.shared.snapshot()
        if owners.stt != 0 || owners.tts != 0 {
            NSLog("[NativeSTTModule] keep audio session active (owners stt=%d tts=%d)",
                  owners.stt, owners.tts)
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
        guard let task = socketTask, isRunning else {
            NSLog("[NativeSTTModule] receiveLoop bail: task=%d isRunning=%d",
                  socketTask != nil ? 1 : 0, isRunning ? 1 : 0)
            return
        }

        task.receive { [weak self] result in
            guard let self else { return }
            guard self.isRunning else { return }

            switch result {
            case .failure(let error):
                NSLog("[NativeSTTModule] ws_receive_failed: %@", error.localizedDescription)
                self.emitError("ws_receive_failed: \(error.localizedDescription)")
                self.stopAndCleanup(reason: "receive_failed")
            case .success(let message):
                self.wsMessageCount += 1
                let count = self.wsMessageCount
                switch message {
                case .string(let text):
                    if count <= 3 || count % 50 == 0 {
                        let preview = text.prefix(120)
                        NSLog("[NativeSTTModule] ws_msg #%lld len=%d preview=%@",
                              count, text.count, String(preview))
                    }
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

    private func startWsPing() {
        stopWsPing()
        let timer = DispatchSource.makeTimerSource(queue: wsQueue)
        timer.schedule(deadline: .now() + 15, repeating: 15)
        timer.setEventHandler { [weak self] in
            guard let self, self.isRunning, let task = self.socketTask else { return }
            task.sendPing { error in
                if let error {
                    NSLog("[NativeSTTModule] ws_ping_failed: %@", error.localizedDescription)
                }
            }
        }
        timer.resume()
        wsPingTimer = timer
    }

    private func stopWsPing() {
        wsPingTimer?.cancel()
        wsPingTimer = nil
    }

    private func startHealthCheck() {
        stopHealthCheck()
        lastChunkCountSnapshot = audioChunkCount
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler { [weak self] in
            guard let self, self.isRunning else { return }
            let current = self.audioChunkCount
            let previous = self.lastChunkCountSnapshot
            self.lastChunkCountSnapshot = current

            let engineRunning = self.audioEngine.isRunning
            if current == previous {
                // No audio chunks in the last 5 seconds while supposedly running.
                NSLog("[NativeSTTModule] healthCheck: STALL detected chunks=%lld engineRunning=%d hasTap=%d",
                      current, engineRunning ? 1 : 0, self.hasInputTap ? 1 : 0)
                self.restartAudioCapture(reason: "health_check_stall")
            } else {
                NSLog("[NativeSTTModule] healthCheck: OK chunks=%lld (+%lld) engineRunning=%d",
                      current, current - previous, engineRunning ? 1 : 0)
            }
        }
        timer.resume()
        healthCheckTimer = timer
    }

    private func stopHealthCheck() {
        healthCheckTimer?.cancel()
        healthCheckTimer = nil
    }

    private func startSession(
        wsUrl: URL,
        wsUrlString: String,
        languages: [String],
        sttModel: String,
        langHintsStrict: Bool,
        aecEnabled: Bool,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        isAecEnabled = aecEnabled
        audioChunkCount = 0
        wsMessageCount = 0
        NSLog("[NativeSTTModule] startSession ws=%@ languages=%@ model=%@ aec=%d",
              wsUrlString, languages.joined(separator: ","), sttModel, aecEnabled ? 1 : 0)

        do {
            try configureAudioSession()
            let audioSession = AVAudioSession.sharedInstance()
            let route = audioSession.currentRoute
            let inputs = route.inputs.map { "\($0.portName)(\($0.portType.rawValue))" }.joined(separator: ",")
            let outputs = route.outputs.map { "\($0.portName)(\($0.portType.rawValue))" }.joined(separator: ",")
            NSLog("[NativeSTTModule] audioRoute inputs=[%@] outputs=[%@] sampleRate=%.0f",
                  inputs, outputs, audioSession.sampleRate)
        } catch {
            reject("audio_session", "Failed to configure AVAudioSession", error)
            return
        }
        if !sttSessionTokenAcquired {
            MingleAudioSessionCoordinator.shared.acquireSTT()
            sttSessionTokenAcquired = true
        }

        installAudioObserversIfNeeded()
        removeTapIfNeeded()
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        // Only reset the engine when the voice-processing state actually changes.
        // A full reset wipes AEC calibration data, forcing re-convergence (= initial echo).
        // When the state hasn't changed we skip the reset to preserve the learned echo path.
        if lastAppliedAec != nil && lastAppliedAec != isAecEnabled {
            audioEngine.reset()
            NSLog("[NativeSTTModule] audioEngine reset for VP state change %d→%d",
                  (lastAppliedAec ?? true) ? 1 : 0, isAecEnabled ? 1 : 0)
        }
        lastAppliedAec = isAecEnabled

        let inputNode = audioEngine.inputNode
        // AEC (voice processing): toggled by user via aecEnabled flag.
        // When enabled, cancels TTS echo from mic input (volume reduction compensated in NativeTTSModule).
        // When disabled, allows echo feedback (intentional use case for echo effect).
        if #available(iOS 17.0, *) { try? inputNode.setVoiceProcessingEnabled(isAecEnabled) }
        let inputFormat = inputNode.inputFormat(forBus: 0)
        let sampleRate = Int(inputFormat.sampleRate.rounded())
        NSLog("[NativeSTTModule] inputFormat=%@ sampleRate=%d", inputFormat.description, sampleRate)

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
        startWsPing()
        startHealthCheck()

        installInputTap(format: inputFormat)

        do {
            audioEngine.prepare()
            try audioEngine.start()
            NSLog("[NativeSTTModule] audioEngine started OK, isRunning=%d", audioEngine.isRunning ? 1 : 0)
        } catch {
            NSLog("[NativeSTTModule] audioEngine start FAILED: %@", error.localizedDescription)
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
        let aecEnabled = options["aecEnabled"] as? Bool ?? false

        let audioSession = AVAudioSession.sharedInstance()
        switch audioSession.recordPermission {
        case .granted:
            startSession(
                wsUrl: wsUrl,
                wsUrlString: wsUrlString,
                languages: languages,
                sttModel: sttModel,
                langHintsStrict: langHintsStrict,
                aecEnabled: aecEnabled,
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
                            aecEnabled: aecEnabled,
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

    @objc(setAec:resolver:rejecter:)
    func setAec(
        _ enabled: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let prev = isAecEnabled
        isAecEnabled = enabled
        lastAppliedAec = enabled
        NSLog("[NativeSTTModule] setAec %d→%d isRunning=%d", prev ? 1 : 0, enabled ? 1 : 0, isRunning ? 1 : 0)

        guard isRunning else {
            resolve(["ok": true])
            return
        }

        // Hot-swap voice processing on the live audio engine.
        // Stop engine → reset engine (VP state change) → re-install tap → restart.
        removeTapIfNeeded()
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.reset()

        let inputNode = audioEngine.inputNode
        if #available(iOS 17.0, *) { try? inputNode.setVoiceProcessingEnabled(enabled) }
        let inputFormat = inputNode.inputFormat(forBus: 0)
        installInputTap(format: inputFormat)

        do {
            audioEngine.prepare()
            try audioEngine.start()
            NSLog("[NativeSTTModule] audioEngine restarted after AEC toggle, isRunning=%d", audioEngine.isRunning ? 1 : 0)
            resolve(["ok": true])
        } catch {
            NSLog("[NativeSTTModule] audioEngine restart after AEC toggle FAILED: %@", error.localizedDescription)
            reject("audio_engine", "Failed to restart after AEC toggle", error)
        }
    }
}
