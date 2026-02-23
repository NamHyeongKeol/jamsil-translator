import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = AppViewModel()
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            timeline
            Divider()
            bottomControlBar
        }
        .background(Color(uiColor: .systemGray6).ignoresSafeArea())
        .sheet(isPresented: $showSettings) {
            settingsSheet
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("Mingle")
                .font(.system(size: 56, weight: .heavy, design: .rounded))
                .foregroundStyle(Color.orange)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            Spacer()

            HStack(spacing: 8) {
                ForEach(Array(displayLanguages.prefix(3)), id: \.self) { rawLanguage in
                    let info = languageInfo(for: rawLanguage)
                    Text("\(info.flag) \(info.code)")
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color.white)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(Color.gray.opacity(0.25), lineWidth: 1)
                        )
                }

                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 34, height: 34)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color.gray.opacity(0.25), lineWidth: 1)
                        )
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(Color(uiColor: .systemGray6))
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if viewModel.utterances.isEmpty, viewModel.partialTranscript.isEmpty {
                        VStack(spacing: 8) {
                            Text("아직 대화가 없습니다.")
                                .font(.system(size: 16, weight: .semibold))
                            Text("아래 재생 버튼을 눌러 STT를 시작해 주세요.")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                    }

                    ForEach(viewModel.utterances) { utterance in
                        VStack(spacing: 10) {
                            sourceBubble(utterance)

                            ForEach(orderedTargetLanguages(for: utterance), id: \.self) { language in
                                translatedBubble(utterance: utterance, language: language)
                            }
                        }
                        .id(utterance.id)
                    }

                    if !viewModel.partialTranscript.isEmpty {
                        bubbleCard(
                            language: viewModel.partialLanguage,
                            text: viewModel.partialTranscript,
                            timestampText: nil,
                            backgroundColor: Color.white,
                            borderColor: Color.gray.opacity(0.18),
                            languageColor: Color.gray.opacity(0.8),
                            textColor: .primary,
                            waiting: false
                        )
                        .overlay(alignment: .bottomTrailing) {
                            Text("듣는 중...")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.orange)
                                .padding(.trailing, 16)
                                .padding(.bottom, 12)
                        }
                        .id("live-partial")
                    }

                    Color.clear.frame(height: 8).id("bottom-anchor")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .onAppear {
                scrollToBottom(proxy)
            }
            .onChange(of: viewModel.utterances.count) { _ in
                scrollToBottom(proxy)
            }
            .onChange(of: viewModel.partialTranscript) { _ in
                scrollToBottom(proxy)
            }
        }
    }

    private func sourceBubble(_ utterance: Utterance) -> some View {
        bubbleCard(
            language: utterance.originalLang,
            text: utterance.originalText,
            timestampText: formattedBubbleTimestamp(ms: utterance.createdAtMs),
            backgroundColor: Color.white,
            borderColor: Color.gray.opacity(0.2),
            languageColor: Color.gray.opacity(0.8),
            textColor: .primary,
            waiting: false
        )
    }

    private func translatedBubble(utterance: Utterance, language: String) -> some View {
        let translatedText = utterance.translations[language]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let waiting = translatedText.isEmpty
        return bubbleCard(
            language: language,
            text: waiting ? "번역 대기 중" : translatedText,
            timestampText: nil,
            backgroundColor: Color(red: 0.98, green: 0.97, blue: 0.90),
            borderColor: Color(red: 0.95, green: 0.87, blue: 0.60),
            languageColor: Color.orange,
            textColor: waiting ? .secondary : .primary,
            waiting: waiting
        )
    }

    private func bubbleCard(
        language: String,
        text: String,
        timestampText: String?,
        backgroundColor: Color,
        borderColor: Color,
        languageColor: Color,
        textColor: Color,
        waiting: Bool
    ) -> some View {
        let info = languageInfo(for: language)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("\(info.flag) \(info.code)")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(languageColor)

                Spacer()

                if let timestampText, !timestampText.isEmpty {
                    Text(timestampText)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.gray.opacity(0.7))
                }
            }

            Text(text)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(textColor)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(waiting ? 0.75 : 1.0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(backgroundColor)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(borderColor, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.06), radius: 6, x: 0, y: 2)
    }

    private var bottomControlBar: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center) {
                Text("\(viewModel.usageSec)s")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()

                Spacer()

                Button {
                    if viewModel.isRecording {
                        viewModel.stopRecording()
                    } else {
                        viewModel.startRecording()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(Color.orange)
                            .frame(width: 94, height: 94)
                            .shadow(color: .black.opacity(0.16), radius: 10, x: 0, y: 6)

                        Image(systemName: viewModel.isRecording ? "stop.fill" : "play.fill")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundStyle(Color.white)
                            .offset(x: viewModel.isRecording ? 0 : 2)
                    }
                }

                Spacer()

                HStack(spacing: 14) {
                    Image(systemName: "speaker.wave.2.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.orange)

                    Image(systemName: "speaker.slash.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.gray)

                    Image(systemName: "mic.slash")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.gray)
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 12)
            .padding(.bottom, 6)

            if let error = viewModel.lastErrorMessage, !error.isEmpty {
                Text(error)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            } else if !viewModel.providerLabel.isEmpty {
                Text(viewModel.providerLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 8)
            } else {
                Text(connectionStatusText)
                    .font(.system(size: 12))
                    .foregroundStyle(connectionColor)
                    .padding(.bottom, 8)
            }
        }
        .background(Color(uiColor: .systemGray6))
    }

    private var settingsSheet: some View {
        NavigationStack {
            Form {
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
                }

                Section("Session") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(connectionStatusText)
                            .foregroundStyle(connectionColor)
                    }

                    if !viewModel.providerLabel.isEmpty {
                        HStack {
                            Text("Translator")
                            Spacer()
                            Text(viewModel.providerLabel)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("대화 기록 초기화", role: .destructive) {
                        viewModel.clearHistory()
                    }
                }
            }
            .navigationTitle("Mingle iOS Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") {
                        showSettings = false
                    }
                }
            }
        }
    }

    private var displayLanguages: [String] {
        let tokens = viewModel.languagesCSV
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var deduped: [String] = []
        var seen = Set<String>()
        for token in tokens {
            let normalized = normalizedLanguageCode(token)
            let key = normalized.isEmpty ? token.lowercased() : normalized
            if seen.contains(key) { continue }
            seen.insert(key)
            deduped.append(token)
        }

        return deduped.isEmpty ? ["ko", "ja", "en"] : deduped
    }

    private func orderedTargetLanguages(for utterance: Utterance) -> [String] {
        var ordered: [String] = []
        var seen = Set<String>()
        let sourceLanguage = normalizedLanguageCode(utterance.originalLang)

        for language in utterance.targetLanguages {
            let normalized = normalizedLanguageCode(language)
            if !sourceLanguage.isEmpty, normalized == sourceLanguage { continue }
            let key = normalized.isEmpty ? language.lowercased() : normalized
            if seen.contains(key) { continue }
            seen.insert(key)
            ordered.append(language)
        }

        for language in utterance.translations.keys {
            let normalized = normalizedLanguageCode(language)
            if !sourceLanguage.isEmpty, normalized == sourceLanguage { continue }
            let key = normalized.isEmpty ? language.lowercased() : normalized
            if seen.contains(key) { continue }
            seen.insert(key)
            ordered.append(language)
        }

        if ordered.isEmpty {
            for language in displayLanguages {
                let normalized = normalizedLanguageCode(language)
                if !sourceLanguage.isEmpty, normalized == sourceLanguage { continue }
                let key = normalized.isEmpty ? language.lowercased() : normalized
                if seen.contains(key) { continue }
                seen.insert(key)
                ordered.append(language)
            }
        }

        return ordered
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo("bottom-anchor", anchor: .bottom)
        }
    }

    private func normalizedLanguageCode(_ raw: String) -> String {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()
        return normalized.split(separator: "-").first.map(String.init) ?? ""
    }

    private func languageInfo(for rawLanguage: String) -> (flag: String, code: String) {
        let normalized = normalizedLanguageCode(rawLanguage)
        let code = normalized.isEmpty ? rawLanguage.uppercased() : normalized.uppercased()
        switch normalized {
        case "ko":
            return ("🇰🇷", "KO")
        case "ja":
            return ("🇯🇵", "JA")
        case "en":
            return ("🇺🇸", "EN")
        default:
            return ("🌐", code)
        }
    }

    private var connectionStatusText: String {
        switch viewModel.connectionStatus {
        case "ready":
            return viewModel.isRecording ? "Listening" : "Ready"
        case "connecting":
            return "Connecting"
        case "stopping":
            return "Stopping"
        case "error":
            return "Error"
        default:
            return "Idle"
        }
    }

    private var connectionColor: Color {
        switch viewModel.connectionStatus {
        case "ready":
            return .green
        case "connecting", "stopping":
            return .orange
        case "error":
            return .red
        default:
            return .secondary
        }
    }

    private func formattedBubbleTimestamp(ms: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let delta = Date().timeIntervalSince(date)
        if delta >= 0, delta < 60 {
            return "\(max(1, Int(delta)))초 전"
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "d일 a h:mm"
        return formatter.string(from: date)
    }
}
