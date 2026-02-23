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

    private let audioCaptureService = AudioCaptureService()
    private let sttSocketClient = STTWebSocketClient()
    private let translateAPIClient = TranslateAPIClient()

    private var partialTranslations: [String: String] = [:]
    private var utteranceSerial = 0
    private var usageTimer: Timer?
    private var sessionKey = AppViewModel.createSessionKey()

    private static let storageApiBaseURL = "mingle_ios_api_base_url"
    private static let storageWsURL = "mingle_ios_ws_url"
    private static let storageLanguages = "mingle_ios_languages_csv"

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
        guard !isRecording else { return }

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
        guard isRecording else { return }

        sttSocketClient.sendStopRecording(
            pendingText: partialTranscript,
            pendingLanguage: partialLanguage
        )
        teardownRecording(setIdleStatus: true)
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
                if self.isRecording {
                    self.connectionStatus = "idle"
                    self.teardownRecording(setIdleStatus: false)
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

        case .stopRecordingAck:
            // stop_recording_ack is currently used as transport-level confirmation.
            break

        case let .usage(finalAudioSec, _):
            if let finalAudioSec {
                usageSec = max(usageSec, Int(finalAudioSec.rounded()))
            }

        case .unsupported:
            break
        }
    }

    private func handleTranscript(_ transcript: ParsedSttTranscriptMessage) {
        if transcript.isFinal {
            if transcript.text.isEmpty {
                clearPartialState()
                return
            }

            utteranceSerial += 1
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            let finalizedPayload = STTWorkflowParser.buildFinalizedUtterancePayload(
                input: BuildFinalizedUtterancePayloadInput(
                    rawText: transcript.rawText,
                    rawLanguage: transcript.language,
                    languages: normalizedLanguages(),
                    partialTranslations: partialTranslations,
                    utteranceSerial: utteranceSerial,
                    nowMs: nowMs,
                    previousStateSourceLanguage: transcript.language,
                    previousStateSourceText: transcript.rawText
                )
            )

            clearPartialState()
            guard let finalizedPayload else {
                return
            }

            utterances.append(finalizedPayload.utterance)

            Task { @MainActor in
                await translateFinalTurn(
                    utteranceId: finalizedPayload.utteranceId,
                    text: finalizedPayload.text,
                    sourceLanguage: finalizedPayload.language,
                    targetLanguages: finalizedPayload.utterance.targetLanguages,
                    currentTurnPreviousState: finalizedPayload.currentTurnPreviousState
                )
            }
            return
        }

        partialTranscript = transcript.text
        partialLanguage = transcript.language
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

        let request = TranslateFinalizeRequest(
            text: text,
            sourceLanguage: sourceLanguage,
            targetLanguages: targetLanguages,
            isFinal: true,
            recentTurns: recentTurns,
            immediatePreviousTurn: immediatePreviousTurn,
            currentTurnPreviousState: currentTurnPreviousState,
            sessionKey: sessionKey
        )

        do {
            let response = try await translateAPIClient.finalize(
                apiBaseURL: apiBaseURL,
                payload: request
            )

            applyFinalTranslations(response.translations, to: utteranceId)

            if let provider = response.provider, let model = response.model {
                providerLabel = "\(provider) · \(model)"
            }
        } catch {
            lastErrorMessage = error.localizedDescription
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

    private static func createSessionKey() -> String {
        let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        return "sess_\(uuid.lowercased())"
    }
}
