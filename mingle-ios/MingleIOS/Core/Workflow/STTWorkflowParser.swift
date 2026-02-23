import Foundation

struct ParsedSttTranscriptMessage: Equatable {
    let rawText: String
    let text: String
    let language: String
    let isFinal: Bool
}

struct ParsedStopFinalTurnMessage: Equatable {
    let rawText: String
    let text: String
    let language: String
}

struct ParsedStopRecordingAckMessage: Equatable {
    let finalized: Bool
    let finalTurn: ParsedStopFinalTurnMessage?
}

enum SttServerEvent: Equatable {
    case ready
    case transcript(ParsedSttTranscriptMessage)
    case stopRecordingAck(ParsedStopRecordingAckMessage)
    case usage(finalAudioSec: Double?, totalAudioSec: Double?)
    case unsupported
}

struct BuildFinalizedUtterancePayloadInput {
    let rawText: String
    let rawLanguage: String
    let languages: [String]
    let partialTranslations: [String: String]
    let utteranceSerial: Int
    let nowMs: Int64
    let previousStateSourceLanguage: String?
    let previousStateSourceText: String?
}

struct BuildFinalizedUtterancePayloadResult {
    let utteranceId: String
    let text: String
    let language: String
    let utterance: Utterance
    let currentTurnPreviousState: CurrentTurnPreviousStatePayload?
}

enum STTWorkflowParser {
    static func parseServerEvent(jsonText: String) -> SttServerEvent? {
        guard
            let data = jsonText.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        if let status = root["status"] as? String, status == "ready" {
            return .ready
        }

        if let type = root["type"] as? String, type == "stop_recording_ack" {
            let data = root["data"] as? [String: Any]
            let finalized = (data?["finalized"] as? Bool) == true

            var finalTurn: ParsedStopFinalTurnMessage?
            if let finalTurnRaw = data?["final_turn"] as? [String: Any] {
                let rawText = (finalTurnRaw["text"] as? String) ?? ""
                let text = normalizeTurnText(rawText)
                let language = ((finalTurnRaw["language"] as? String) ?? "unknown")
                if !text.isEmpty {
                    finalTurn = ParsedStopFinalTurnMessage(
                        rawText: rawText,
                        text: text,
                        language: language
                    )
                }
            }

            return .stopRecordingAck(
                ParsedStopRecordingAckMessage(
                    finalized: finalized,
                    finalTurn: finalTurn
                )
            )
        }

        if let type = root["type"] as? String, type == "usage" {
            let data = root["data"] as? [String: Any]
            let finalAudio = asDouble(data?["final_audio_sec"])
            let totalAudio = asDouble(data?["total_audio_sec"])
            return .usage(finalAudioSec: finalAudio, totalAudioSec: totalAudio)
        }

        if let transcript = parseTranscript(from: root) {
            return .transcript(transcript)
        }

        return .unsupported
    }

    static func normalizeTurnText(_ rawText: String) -> String {
        let markerStripped = rawText.replacingOccurrences(
            of: #"</?(?:end|fin)>"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        let punctuationStripped = markerStripped.replacingOccurrences(
            of: #"^[\s\.,!\?;:，。、…—–-]+"#,
            with: "",
            options: .regularExpression
        )
        return punctuationStripped.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func normalizeLangForCompare(_ rawLanguage: String) -> String {
        let normalized = rawLanguage
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()
        return normalized.split(separator: "-").first.map(String.init) ?? ""
    }

    static func stripSourceLanguageFromTranslations(
        _ translationsRaw: [String: String],
        sourceLanguageRaw: String
    ) -> [String: String] {
        let sourceLanguage = normalizeLangForCompare(sourceLanguageRaw)
        var filtered: [String: String] = [:]

        for (languageRaw, textRaw) in translationsRaw {
            let language = languageRaw.trimmingCharacters(in: .whitespacesAndNewlines)
            let text = textRaw.trimmingCharacters(in: .whitespacesAndNewlines)
            if language.isEmpty || text.isEmpty { continue }
            if !sourceLanguage.isEmpty,
               normalizeLangForCompare(language) == sourceLanguage {
                continue
            }
            filtered[language] = text
        }

        return filtered
    }

    static func buildTurnTargetLanguagesSnapshot(
        languagesRaw: [String],
        sourceLanguageRaw: String
    ) -> [String] {
        let sourceLanguage = normalizeLangForCompare(sourceLanguageRaw)
        var targetLanguages: [String] = []
        var seen = Set<String>()

        for languageRaw in languagesRaw {
            let language = languageRaw.trimmingCharacters(in: .whitespacesAndNewlines)
            if language.isEmpty { continue }

            let normalized = normalizeLangForCompare(language)
            if !sourceLanguage.isEmpty, normalized == sourceLanguage {
                continue
            }

            let key = normalized.isEmpty ? language.lowercased() : normalized
            if seen.contains(key) { continue }
            seen.insert(key)
            targetLanguages.append(language)
        }

        return targetLanguages
    }

    static func buildCurrentTurnPreviousStatePayload(
        sourceLanguageRaw: String,
        sourceTextRaw: String,
        translationsRaw: [String: String]
    ) -> CurrentTurnPreviousStatePayload? {
        let sourceLanguage = sourceLanguageRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedSourceLanguage = sourceLanguage.isEmpty ? "unknown" : sourceLanguage
        let sourceText = normalizeTurnText(sourceTextRaw)
        if sourceText.isEmpty { return nil }

        let translations = stripSourceLanguageFromTranslations(
            translationsRaw,
            sourceLanguageRaw: resolvedSourceLanguage
        )

        return CurrentTurnPreviousStatePayload(
            sourceLanguage: resolvedSourceLanguage,
            sourceText: sourceText,
            translations: translations
        )
    }

    static func buildFinalizedUtterancePayload(
        input: BuildFinalizedUtterancePayloadInput
    ) -> BuildFinalizedUtterancePayloadResult? {
        let text = normalizeTurnText(input.rawText)
        if text.isEmpty { return nil }

        let language = input.rawLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedLanguage = language.isEmpty ? "unknown" : language

        let seedTranslations = stripSourceLanguageFromTranslations(
            input.partialTranslations,
            sourceLanguageRaw: resolvedLanguage
        )
        let targetLanguages = buildTurnTargetLanguagesSnapshot(
            languagesRaw: input.languages,
            sourceLanguageRaw: resolvedLanguage
        )

        var translationFinalized: [String: Bool] = [:]
        for language in seedTranslations.keys {
            translationFinalized[language] = false
        }

        let currentTurnPreviousState = buildCurrentTurnPreviousStatePayload(
            sourceLanguageRaw: input.previousStateSourceLanguage ?? input.rawLanguage,
            sourceTextRaw: input.previousStateSourceText ?? input.rawText,
            translationsRaw: seedTranslations
        )

        let utteranceId = "u-\(input.nowMs)-\(input.utteranceSerial)"
        let utterance = Utterance(
            id: utteranceId,
            originalText: text,
            originalLang: resolvedLanguage,
            targetLanguages: targetLanguages,
            translations: seedTranslations,
            translationFinalized: translationFinalized,
            createdAtMs: input.nowMs
        )

        return BuildFinalizedUtterancePayloadResult(
            utteranceId: utteranceId,
            text: text,
            language: resolvedLanguage,
            utterance: utterance,
            currentTurnPreviousState: currentTurnPreviousState
        )
    }

    private static func parseTranscript(from root: [String: Any]) -> ParsedSttTranscriptMessage? {
        guard
            let type = root["type"] as? String,
            type == "transcript",
            let data = root["data"] as? [String: Any],
            let utterance = data["utterance"] as? [String: Any]
        else {
            return nil
        }

        let rawText = (utterance["text"] as? String) ?? ""
        let text = normalizeTurnText(rawText)
        let language = ((utterance["language"] as? String) ?? "unknown")
        let isFinal = (data["is_final"] as? Bool) == true

        return ParsedSttTranscriptMessage(
            rawText: rawText,
            text: text,
            language: language,
            isFinal: isFinal
        )
    }

    private static func asDouble(_ value: Any?) -> Double? {
        if let n = value as? NSNumber {
            return n.doubleValue
        }
        if let s = value as? String {
            return Double(s)
        }
        return nil
    }
}
