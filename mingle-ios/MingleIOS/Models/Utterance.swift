import Foundation

struct Utterance: Identifiable, Equatable {
    let id: String
    var originalText: String
    var originalLang: String
    var targetLanguages: [String]
    var translations: [String: String]
    var translationFinalized: [String: Bool]
    var createdAtMs: Int64
}

struct CurrentTurnPreviousStatePayload: Codable {
    let sourceLanguage: String
    let sourceText: String
    let translations: [String: String]
}

struct RecentTurnContextPayload: Codable {
    let sourceLanguage: String
    let sourceText: String
    let translations: [String: String]
    let occurredAtMs: Int64
    let ageMs: Int64
    let isFinalized: Bool
}
