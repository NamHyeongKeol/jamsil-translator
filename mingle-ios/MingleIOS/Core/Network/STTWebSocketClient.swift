import Foundation

struct STTConfigPayload: Encodable {
    let sample_rate: Double
    let languages: [String]
    let stt_model: String
    let lang_hints_strict: Bool
}

private struct AudioChunkPayload: Encodable {
    struct ChunkData: Encodable {
        let chunk: String
    }

    let type: String = "audio_chunk"
    let data: ChunkData
}

private struct StopRecordingPayload: Encodable {
    struct StopData: Encodable {
        let pending_text: String
        let pending_language: String
    }

    let type: String = "stop_recording"
    let data: StopData
}

@MainActor
final class STTWebSocketClient {
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private let encoder = JSONEncoder()
    private var isDisconnecting = false

    var onRawMessage: ((String) -> Void)?
    var onConnected: (() -> Void)?
    var onClosed: ((String?) -> Void)?
    var onError: ((String) -> Void)?

    func connect(url: URL, config: STTConfigPayload) {
        disconnect()
        isDisconnecting = false

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.webSocketTask = task

        task.resume()
        onConnected?()

        receiveLoop(for: task)
        sendEncodable(config)
    }

    func sendAudioChunk(_ base64Chunk: String) {
        let payload = AudioChunkPayload(data: .init(chunk: base64Chunk))
        sendEncodable(payload)
    }

    func sendStopRecording(pendingText: String, pendingLanguage: String) {
        let payload = StopRecordingPayload(data: .init(
            pending_text: pendingText,
            pending_language: pendingLanguage
        ))
        sendEncodable(payload)
    }

    func disconnect() {
        if let task = webSocketTask {
            isDisconnecting = true
            task.cancel(with: .goingAway, reason: nil)
        } else {
            isDisconnecting = false
        }
        webSocketTask = nil
        session?.invalidateAndCancel()
        session = nil
    }

    private func receiveLoop(for task: URLSessionWebSocketTask) {
        guard task === webSocketTask else { return }

        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                guard task === self.webSocketTask else {
                    // Ignore stale callbacks from previous websocket sessions.
                    return
                }
                self.handleReceiveResult(result, for: task)
            }
        }
    }

    private func handleReceiveResult(
        _ result: Result<URLSessionWebSocketTask.Message, Error>,
        for task: URLSessionWebSocketTask
    ) {
        guard task === webSocketTask else { return }

        switch result {
        case let .success(message):
            switch message {
            case let .string(text):
                onRawMessage?(text)
            case let .data(data):
                let text = String(data: data, encoding: .utf8) ?? ""
                onRawMessage?(text)
            @unknown default:
                onError?("Unsupported websocket message")
            }
            receiveLoop(for: task)

        case let .failure(error):
            if isDisconnecting {
                isDisconnecting = false
                onClosed?(nil)
            } else {
                onClosed?(error.localizedDescription)
            }
        }
    }

    private func sendEncodable<T: Encodable>(_ payload: T) {
        guard let task = webSocketTask else { return }

        do {
            let data = try encoder.encode(payload)
            guard let text = String(data: data, encoding: .utf8) else {
                onError?("Failed to serialize websocket payload")
                return
            }

            task.send(.string(text)) { [weak self] error in
                if let error {
                    Task { @MainActor in
                        guard let self else { return }
                        guard task === self.webSocketTask else { return }
                        self.onError?(error.localizedDescription)
                    }
                }
            }
        } catch {
            onError?(error.localizedDescription)
        }
    }
}
