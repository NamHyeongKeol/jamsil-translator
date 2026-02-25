import AVFoundation
import Foundation

@MainActor
final class AppViewModel: ObservableObject {
    @Published var apiBaseURL: String
    @Published var wsURL: String
    @Published var languagesCSV: String
    @Published var connectionStatus: String = "idle"
    @Published var isRecording: Bool = false
    @Published var partialTranscript: String = ""
    @Published var partialLanguage: String = "unknown"
    @Published var utterances: [Utterance] = []
    @Published var volumeLevel: Float = 0
    @Published var usageSec: Int = 0
    @Published var providerLabel: String = ""
    @Published var lastErrorMessage: String?
    var ttsEnabled: Bool = false
    var aecEnabled: Bool = false

    func updateAec(enabled: Bool) {
        aecEnabled = enabled
        if isRecording {
            audioCaptureService.updateAecMode(enabled: enabled)
        }
    }

    private let audioCaptureService = AudioCaptureService()
    private let sttSocketClient = STTWebSocketClient()
    private let translateAPIClient = TranslateAPIClient()
    private var ttsAudioPlayer: AVAudioPlayer?

    private struct PendingLocalFinalize {
        let utteranceId: String
        let text: String
        let language: String
        let expiresAtMs: Int64
    }

    private var partialTranslations: [String: String] = [:]
    private var utteranceSerial = 0
    private var usageTimer: Timer?
    private var sessionKey = AppViewModel.createSessionKey()
    private var isStopping = false
    private var stopFinalizeDedup: (signature: String, expiresAtMs: Int64)?
    private var pendingLocalFinalize: PendingLocalFinalize?
    private var stopAckTimeoutTask: Task<Void, Never>?

    private static let storageApiBaseURL = "mingle_ios_api_base_url"
    private static let storageWsURL = "mingle_ios_ws_url"
    private static let storageLanguages = "mingle_ios_languages_csv"
    private static let finalDuplicateWindowMs: Int64 = 5_000
    private static let stopFinalizeDedupeWindowMs: Int64 = 5_000
    private static let pendingFinalizeMergeWindowMs: Int64 = 15_000
    private static let stopAckTimeoutNs: UInt64 = 1_500_000_000

    init() {
        let defaults = UserDefaults.standard
        let configuredApi = defaults.string(forKey: Self.storageApiBaseURL)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let configuredWs = defaults.string(forKey: Self.storageWsURL)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let configuredLanguages = defaults.string(forKey: Self.storageLanguages)?.trimmingCharacters(in: .whitespacesAndNewlines)

        self.apiBaseURL = configuredApi?.isEmpty == false
            ? configuredApi!
            : (Bundle.main.object(forInfoDictionaryKey: "MINGLE_API_BASE_URL") as? String ?? "http://127.0.0.1:3000")
        self.wsURL = configuredWs?.isEmpty == false
            ? configuredWs!
            : (Bundle.main.object(forInfoDictionaryKey: "MINGLE_WS_URL") as? String ?? "ws://127.0.0.1:3001")
        self.languagesCSV = configuredLanguages?.isEmpty == false ? configuredLanguages! : "en,ko"

        bindSocketCallbacks()
    }

    func startRecording() {
        guard !isRecording, !isStopping else { return }

        let languages = normalizedLanguages()
        if languages.isEmpty {
            lastErrorMessage = "최소 1개 언어를 선택해 주세요."
            return
        }

        guard let socketURL = URL(string: wsURL) else {
            lastErrorMessage = "WS URL이 올바르지 않습니다: \(wsURL)"
            return
        }

        persistConfig()
        sessionKey = Self.createSessionKey()
        lastErrorMessage = nil
        providerLabel = ""
        connectionStatus = "connecting"

        Task { @MainActor in
            let granted = await audioCaptureService.requestMicrophonePermission()
            guard granted else {
                connectionStatus = "error"
                lastErrorMessage = "마이크 권한이 필요합니다."
                return
            }

            do {
                try audioCaptureService.start(
                    aecEnabled: aecEnabled,
                    onAudioChunk: { [weak self] base64 in
                        guard let self else { return }
                        Task { @MainActor in
                            self.sttSocketClient.sendAudioChunk(base64)
                        }
                    },
                    onRmsLevel: { [weak self] rms in
                        guard let self else { return }
                        Task { @MainActor in
                            self.volumeLevel = rms
                        }
                    }
                )

                isRecording = true
                usageSec = 0
                startUsageTimer()

                let config = STTConfigPayload(
                    sample_rate: audioCaptureService.sampleRate,
                    languages: languages,
                    stt_model: "soniox",
                    lang_hints_strict: true
                )
                sttSocketClient.connect(url: socketURL, config: config)
            } catch {
                failStartRecording(message: error.localizedDescription)
            }
        }
    }

    func stopRecording() {
        guard isRecording, !isStopping else { return }

        isStopping = true
        connectionStatus = "stopping"

        usageTimer?.invalidate()
        usageTimer = nil
        audioCaptureService.stop()
        volumeLevel = 0
        isRecording = false

        let pendingText = partialTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        let pendingLanguage = partialLanguage

        if !pendingText.isEmpty {
            handleFinalizedRawTurn(
                rawText: pendingText,
                rawLanguage: pendingLanguage,
                previousStateSourceLanguage: pendingLanguage,
                previousStateSourceText: pendingText,
                preferPendingFinalizeText: true,
                setPendingLocalFinalizeForMerge: true
            )
        }

        sttSocketClient.sendStopRecording(
            pendingText: pendingText,
            pendingLanguage: pendingLanguage
        )
        scheduleStopAckTimeout()
    }

    func clearHistory() {
        utterances = []
        partialTranscript = ""
        partialLanguage = "unknown"
        partialTranslations = [:]
        utteranceSerial = 0
    }

    private func bindSocketCallbacks() {
        sttSocketClient.onConnected = { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                self.connectionStatus = "connecting"
            }
        }

        sttSocketClient.onRawMessage = { [weak self] rawText in
            guard let self else { return }
            Task { @MainActor in
                self.handleServerRawMessage(rawText)
            }
        }

        sttSocketClient.onClosed = { [weak self] reason in
            guard let self else { return }
            Task { @MainActor in
                if self.isStopping {
                    self.completeStoppingFlow()
                    return
                }

                if self.isRecording {
                    let pendingText = self.partialTranscript
                    let pendingLanguage = self.partialLanguage
                    self.teardownRecording(setIdleStatus: false)
                    if !pendingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        self.handleFinalizedRawTurn(
                            rawText: pendingText,
                            rawLanguage: pendingLanguage,
                            previousStateSourceLanguage: pendingLanguage,
                            previousStateSourceText: pendingText,
                            preferPendingFinalizeText: false,
                            setPendingLocalFinalizeForMerge: false
                        )
                    }

                    let closeReason = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if closeReason.isEmpty {
                        self.lastErrorMessage = "연결이 종료되었습니다."
                    } else {
                        self.lastErrorMessage = closeReason
                    }
                    self.connectionStatus = "error"
                    return
                }
                if let reason, !reason.isEmpty {
                    self.lastErrorMessage = reason
                }
            }
        }

        sttSocketClient.onError = { [weak self] message in
            guard let self else { return }
            Task { @MainActor in
                self.lastErrorMessage = message
            }
        }
    }

    private func handleServerRawMessage(_ rawText: String) {
        guard let event = STTWorkflowParser.parseServerEvent(jsonText: rawText) else {
            return
        }

        switch event {
        case .ready:
            connectionStatus = "ready"

        case let .transcript(transcript):
            handleTranscript(transcript)

        case let .stopRecordingAck(ack):
            handleStopRecordingAck(ack)

        case let .usage(finalAudioSec, _):
            if let finalAudioSec {
                usageSec = max(usageSec, Int(finalAudioSec.rounded()))
            }

        case .unsupported:
            break
        }
    }

    private func handleTranscript(_ transcript: ParsedSttTranscriptMessage) {
        if isStopping, !transcript.isFinal {
            return
        }

        if transcript.isFinal {
            handleFinalizedRawTurn(
                rawText: transcript.rawText,
                rawLanguage: transcript.language,
                previousStateSourceLanguage: partialLanguage,
                previousStateSourceText: partialTranscript,
                preferPendingFinalizeText: isStopping,
                setPendingLocalFinalizeForMerge: false
            )
            return
        }

        partialTranscript = transcript.text
        partialLanguage = transcript.language
    }

    private func handleStopRecordingAck(_ ack: ParsedStopRecordingAckMessage) {
        if let finalTurn = ack.finalTurn {
            handleFinalizedRawTurn(
                rawText: finalTurn.rawText,
                rawLanguage: finalTurn.language,
                previousStateSourceLanguage: finalTurn.language,
                previousStateSourceText: finalTurn.rawText,
                preferPendingFinalizeText: true,
                setPendingLocalFinalizeForMerge: false
            )
        }

        completeStoppingFlow()
    }

    private func scheduleStopAckTimeout() {
        stopAckTimeoutTask?.cancel()
        stopAckTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.stopAckTimeoutNs)
            guard let self else { return }
            await MainActor.run {
                self.completeStoppingFlow()
            }
        }
    }

    private func completeStoppingFlow() {
        guard isStopping else { return }

        stopAckTimeoutTask?.cancel()
        stopAckTimeoutTask = nil
        isStopping = false
        pendingLocalFinalize = nil

        sttSocketClient.disconnect()
        connectionStatus = "idle"
        clearPartialState()
    }

    private func handleFinalizedRawTurn(
        rawText: String,
        rawLanguage: String,
        previousStateSourceLanguage: String?,
        previousStateSourceText: String?,
        preferPendingFinalizeText: Bool,
        setPendingLocalFinalizeForMerge: Bool
    ) {
        let text = STTWorkflowParser.normalizeTurnText(rawText)
        if text.isEmpty {
            clearPartialState()
            return
        }

        let languageRaw = rawLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
        let language = languageRaw.isEmpty ? "unknown" : languageRaw
        let nowMs = Self.nowMs()
        let signature = "\(language)::\(text)"

        if let dedupe = stopFinalizeDedup {
            if nowMs < dedupe.expiresAtMs, dedupe.signature == signature {
                stopFinalizeDedup = nil
                clearPartialState()
                return
            }
            if nowMs >= dedupe.expiresAtMs {
                stopFinalizeDedup = nil
            }
        }

        if isLikelyRecentDuplicateFinal(text: text, language: language, nowMs: nowMs) {
            clearPartialState()
            pendingLocalFinalize = nil
            return
        }

        if mergeWithPendingLocalFinalizeIfNeeded(
            text: text,
            language: language,
            nowMs: nowMs,
            preferPendingText: preferPendingFinalizeText
        ) {
            clearPartialState()
            return
        }

        utteranceSerial += 1
        let finalizedPayload = STTWorkflowParser.buildFinalizedUtterancePayload(
            input: BuildFinalizedUtterancePayloadInput(
                rawText: rawText,
                rawLanguage: language,
                languages: normalizedLanguages(),
                partialTranslations: partialTranslations,
                utteranceSerial: utteranceSerial,
                nowMs: nowMs,
                previousStateSourceLanguage: previousStateSourceLanguage ?? language,
                previousStateSourceText: previousStateSourceText ?? rawText
            )
        )

        clearPartialState()
        guard let finalizedPayload else {
            return
        }

        utterances.append(finalizedPayload.utterance)
        if setPendingLocalFinalizeForMerge {
            stopFinalizeDedup = (
                signature: "\(finalizedPayload.language)::\(finalizedPayload.text)",
                expiresAtMs: nowMs + Self.stopFinalizeDedupeWindowMs
            )
            pendingLocalFinalize = PendingLocalFinalize(
                utteranceId: finalizedPayload.utteranceId,
                text: finalizedPayload.text,
                language: finalizedPayload.language,
                expiresAtMs: nowMs + Self.pendingFinalizeMergeWindowMs
            )
        } else {
            pendingLocalFinalize = nil
        }

        Task { @MainActor in
            await translateFinalTurn(
                utteranceId: finalizedPayload.utteranceId,
                text: finalizedPayload.text,
                sourceLanguage: finalizedPayload.language,
                targetLanguages: finalizedPayload.utterance.targetLanguages,
                currentTurnPreviousState: finalizedPayload.currentTurnPreviousState
            )
        }
    }

    private func isLikelyRecentDuplicateFinal(text: String, language: String, nowMs: Int64) -> Bool {
        guard let lastUtterance = utterances.last else { return false }
        if (nowMs - lastUtterance.createdAtMs) > Self.finalDuplicateWindowMs { return false }

        let lastLanguage = STTWorkflowParser.normalizeLangForCompare(lastUtterance.originalLang)
        let currentLanguage = STTWorkflowParser.normalizeLangForCompare(language)
        if lastLanguage != currentLanguage { return false }

        let lastText = STTWorkflowParser.normalizeTurnText(lastUtterance.originalText)
        return lastText == text
    }

    private func mergeWithPendingLocalFinalizeIfNeeded(
        text: String,
        language: String,
        nowMs: Int64,
        preferPendingText: Bool
    ) -> Bool {
        guard let pending = pendingLocalFinalize else { return false }
        if nowMs >= pending.expiresAtMs {
            pendingLocalFinalize = nil
            return false
        }

        if STTWorkflowParser.normalizeLangForCompare(pending.language)
            != STTWorkflowParser.normalizeLangForCompare(language) {
            return false
        }

        if !text.starts(with: pending.text), !pending.text.starts(with: text) {
            return false
        }

        guard let index = utterances.firstIndex(where: { $0.id == pending.utteranceId }) else {
            pendingLocalFinalize = nil
            return false
        }

        let mergedText = preferPendingText
            ? pending.text
            : (text.count >= pending.text.count ? text : pending.text)
        utterances[index].originalText = mergedText
        pendingLocalFinalize = nil
        return true
    }

    private func translateFinalTurn(
        utteranceId: String,
        text: String,
        sourceLanguage: String,
        targetLanguages: [String],
        currentTurnPreviousState: CurrentTurnPreviousStatePayload?
    ) async {
        if targetLanguages.isEmpty || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return
        }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let recentTurns = buildRecentTurnContext(nowMs: nowMs, excludeUtteranceId: utteranceId)
        let immediatePreviousTurn = recentTurns.last

        let ttsPayload: TTSRequestPayload?
        if ttsEnabled, let ttsLang = targetLanguages.first {
            ttsPayload = TTSRequestPayload(enabled: true, language: ttsLang, voiceId: nil)
        } else {
            ttsPayload = nil
        }

        let request = TranslateFinalizeRequest(
            text: text,
            sourceLanguage: sourceLanguage,
            targetLanguages: targetLanguages,
            isFinal: true,
            recentTurns: recentTurns,
            immediatePreviousTurn: immediatePreviousTurn,
            currentTurnPreviousState: currentTurnPreviousState,
            sessionKey: sessionKey,
            tts: ttsPayload
        )

        let maxRetries = 2
        var lastError: Error?

        for attempt in 0...maxRetries {
            if attempt > 0 {
                try? await Task.sleep(nanoseconds: 500_000_000)
            }

            do {
                let response = try await translateAPIClient.finalize(
                    apiBaseURL: apiBaseURL,
                    payload: request
                )

                applyFinalTranslations(response.translations, to: utteranceId)

                if let provider = response.provider, let model = response.model {
                    providerLabel = "\(provider) · \(model)"
                }

                if ttsEnabled, let base64Audio = response.ttsAudioBase64, !base64Audio.isEmpty {
                    playTTSAudio(base64: base64Audio)
                }
                return
            } catch let error as TranslateAPIClientError {
                lastError = error
                if case let .server(statusCode, _) = error, statusCode == 502 {
                    continue
                }
                break
            } catch {
                lastError = error
                break
            }
        }

        if let lastError {
            lastErrorMessage = lastError.localizedDescription
        }
    }

    private func applyFinalTranslations(_ translationsRaw: [String: String], to utteranceId: String) {
        guard let index = utterances.firstIndex(where: { $0.id == utteranceId }) else {
            return
        }

        let sourceLanguage = utterances[index].originalLang
        let filtered = STTWorkflowParser.stripSourceLanguageFromTranslations(
            translationsRaw,
            sourceLanguageRaw: sourceLanguage
        )

        if filtered.isEmpty { return }

        for (language, translatedText) in filtered {
            utterances[index].translations[language] = translatedText
            utterances[index].translationFinalized[language] = true
        }
    }

    private func playTTSAudio(base64: String) {
        guard let data = Data(base64Encoded: base64), !data.isEmpty else { return }
        do {
            let player = try AVAudioPlayer(data: data)
            ttsAudioPlayer = player
            player.play()
        } catch {
            // TTS playback failed silently.
        }
    }

    private func buildRecentTurnContext(nowMs: Int64, excludeUtteranceId: String) -> [RecentTurnContextPayload] {
        let windowMs: Int64 = 10_000
        let windowStart = nowMs - windowMs

        let turns = utterances.compactMap { utterance -> RecentTurnContextPayload? in
            if utterance.id == excludeUtteranceId { return nil }
            if utterance.createdAtMs < windowStart || utterance.createdAtMs > nowMs { return nil }

            let sourceText = utterance.originalText.trimmingCharacters(in: .whitespacesAndNewlines)
            if sourceText.isEmpty { return nil }

            let sourceLanguage = utterance.originalLang.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedSourceLanguage = sourceLanguage.isEmpty ? "unknown" : sourceLanguage
            let translations = STTWorkflowParser.stripSourceLanguageFromTranslations(
                utterance.translations,
                sourceLanguageRaw: normalizedSourceLanguage
            )
            let translationLanguages = Array(translations.keys)
            let isFinalized = !translationLanguages.isEmpty && translationLanguages.allSatisfy {
                utterance.translationFinalized[$0] == true
            }

            return RecentTurnContextPayload(
                sourceLanguage: normalizedSourceLanguage,
                sourceText: sourceText,
                translations: translations,
                occurredAtMs: utterance.createdAtMs,
                ageMs: max(0, nowMs - utterance.createdAtMs),
                isFinalized: isFinalized
            )
        }

        return turns.sorted { $0.occurredAtMs < $1.occurredAtMs }
    }

    private func normalizedLanguages() -> [String] {
        let tokens = languagesCSV
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var deduped: [String] = []
        var seen = Set<String>()

        for token in tokens {
            let key = STTWorkflowParser.normalizeLangForCompare(token)
            let dedupeKey = key.isEmpty ? token.lowercased() : key
            if seen.contains(dedupeKey) { continue }
            seen.insert(dedupeKey)
            deduped.append(token)
        }

        return deduped
    }

    private func clearPartialState() {
        partialTranscript = ""
        partialLanguage = "unknown"
        partialTranslations = [:]
    }

    private func startUsageTimer() {
        usageTimer?.invalidate()
        usageTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.usageSec += 1
            }
        }
    }

    private func teardownRecording(setIdleStatus: Bool) {
        stopAckTimeoutTask?.cancel()
        stopAckTimeoutTask = nil
        isStopping = false
        pendingLocalFinalize = nil

        usageTimer?.invalidate()
        usageTimer = nil

        audioCaptureService.stop()
        sttSocketClient.disconnect()

        isRecording = false
        volumeLevel = 0
        clearPartialState()

        if setIdleStatus {
            connectionStatus = "idle"
        }
    }

    private func failStartRecording(message: String) {
        lastErrorMessage = message
        connectionStatus = "error"
        teardownRecording(setIdleStatus: false)
    }

    private func persistConfig() {
        let defaults = UserDefaults.standard
        defaults.set(apiBaseURL, forKey: Self.storageApiBaseURL)
        defaults.set(wsURL, forKey: Self.storageWsURL)
        defaults.set(languagesCSV, forKey: Self.storageLanguages)
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private static func createSessionKey() -> String {
        let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        return "sess_\(uuid.lowercased())"
    }
}
