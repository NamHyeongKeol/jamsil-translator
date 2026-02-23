import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = AppViewModel()

    var body: some View {
        NavigationStack {
            List {
                backendSection
                sessionSection
                partialSection
                historySection
            }
            .navigationTitle("Mingle iOS")
        }
    }

    private var backendSection: some View {
        Section("Backend") {
            TextField("API Base URL", text: $viewModel.apiBaseURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)

            TextField("WS URL", text: $viewModel.wsURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)

            TextField("Languages (comma-separated)", text: $viewModel.languagesCSV)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Text("예: en,ko,ja")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var sessionSection: some View {
        Section("Session") {
            HStack {
                Text("Status")
                Spacer()
                Text(viewModel.connectionStatus)
                    .fontWeight(.semibold)
                    .foregroundStyle(statusColor(viewModel.connectionStatus))
            }

            HStack {
                Text("Usage")
                Spacer()
                Text("\(viewModel.usageSec)s")
                    .monospacedDigit()
            }

            HStack(spacing: 12) {
                Button(viewModel.isRecording ? "Stop" : "Start") {
                    if viewModel.isRecording {
                        viewModel.stopRecording()
                    } else {
                        viewModel.startRecording()
                    }
                }
                .buttonStyle(.borderedProminent)

                Button("Clear") {
                    viewModel.clearHistory()
                }
                .buttonStyle(.bordered)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Mic Level")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ProgressView(value: min(max(Double(viewModel.volumeLevel) * 7.0, 0), 1))
                    .tint(.orange)
            }

            if !viewModel.providerLabel.isEmpty {
                HStack {
                    Text("Translator")
                    Spacer()
                    Text(viewModel.providerLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let error = viewModel.lastErrorMessage, !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private var partialSection: some View {
        if !viewModel.partialTranscript.isEmpty {
            Section("Live Partial") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(viewModel.partialTranscript)
                        .font(.body)
                    Text(viewModel.partialLanguage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var historySection: some View {
        Section("Turns") {
            if viewModel.utterances.isEmpty {
                Text("아직 확정된 발화가 없습니다.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(viewModel.utterances.reversed())) { utterance in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(utterance.originalLang.uppercased())
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(formatTimestamp(ms: utterance.createdAtMs))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Text(utterance.originalText)
                            .font(.body)

                        if utterance.translations.isEmpty {
                            Text("번역 대기 중")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(utterance.translations.keys.sorted(), id: \.self) { language in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(language.uppercased())
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text(utterance.translations[language] ?? "")
                                        .font(.subheadline)
                                }
                                .padding(.leading, 8)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "ready":
            return .green
        case "connecting":
            return .orange
        case "error":
            return .red
        default:
            return .secondary
        }
    }

    private func formatTimestamp(ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}
