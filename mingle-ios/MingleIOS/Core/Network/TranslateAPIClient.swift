import Foundation

struct TranslateFinalizeRequest: Encodable {
    let text: String
    let sourceLanguage: String
    let targetLanguages: [String]
    let isFinal: Bool
    let recentTurns: [RecentTurnContextPayload]
    let immediatePreviousTurn: RecentTurnContextPayload?
    let currentTurnPreviousState: CurrentTurnPreviousStatePayload?
    let sessionKey: String
}

struct TranslateFinalizeResponse: Decodable {
    let translations: [String: String]
    let provider: String?
    let model: String?
}

enum TranslateAPIClientError: LocalizedError {
    case invalidBaseURL(String)
    case invalidResponse
    case server(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case let .invalidBaseURL(value):
            return "Invalid API base URL: \(value)"
        case .invalidResponse:
            return "Invalid API response"
        case let .server(statusCode, message):
            return "Translation API failed (\(statusCode)): \(message)"
        }
    }
}

@MainActor
final class TranslateAPIClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func finalize(
        apiBaseURL: String,
        payload: TranslateFinalizeRequest
    ) async throws -> TranslateFinalizeResponse {
        guard let baseURL = URL(string: apiBaseURL) else {
            throw TranslateAPIClientError.invalidBaseURL(apiBaseURL)
        }

        let endpoint = baseURL.appending(path: "api/translate/finalize")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoded = try JSONEncoder().encode(payload)
        request.httpBody = encoded

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TranslateAPIClientError.invalidResponse
        }

        if !(200...299).contains(httpResponse.statusCode) {
            let message = String(data: data, encoding: .utf8) ?? "unknown error"
            throw TranslateAPIClientError.server(statusCode: httpResponse.statusCode, message: message)
        }

        return try JSONDecoder().decode(TranslateFinalizeResponse.self, from: data)
    }
}
