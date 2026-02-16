import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

@objc(NativeAudioSessionPlugin)
class NativeAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAudioSessionPlugin"
    public let jsName = "NativeAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
    ]

    @objc func setMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "playback"
        let session = AVAudioSession.sharedInstance()
        NSLog("[NativeAudioSession] request mode=%@", mode)

        do {
            switch mode {
            case "recording":
                try session.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
                )
                try session.overrideOutputAudioPort(.speaker)
                try session.setActive(true, options: [])
            case "playback":
                try session.setCategory(
                    .playback,
                    mode: .default,
                    options: []
                )
                try session.setActive(true, options: [])
            default:
                call.reject("Unsupported mode: \(mode)")
                return
            }

            call.resolve([
                "mode": mode,
            ])
            NSLog("[NativeAudioSession] applied mode=%@ category=%@ route=%@", mode, session.category.rawValue, String(describing: session.currentRoute.outputs.first?.portType.rawValue))
        } catch {
            NSLog("[NativeAudioSession] failed mode=%@ error=%@", mode, String(describing: error))
            call.reject("Failed to configure AVAudioSession", nil, error)
        }
    }
}

@objc(NativeTTSPlayerPlugin)
class NativeTTSPlayerPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "NativeTTSPlayerPlugin"
    public let jsName = "NativeTTSPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var audioPlayer: AVAudioPlayer?
    private var activePlayCallId: String?

    private func clearActivePlayback() {
        if let player = audioPlayer {
            player.stop()
            player.delegate = nil
        }
        audioPlayer = nil
    }

    private func rejectActivePlayCall(_ message: String) {
        guard let callId = activePlayCallId else { return }
        activePlayCallId = nil
        guard let call = bridge?.savedCall(withID: callId) else { return }
        call.reject(message)
        bridge?.releaseCall(call)
    }

    private func resolveActivePlayCall() {
        guard let callId = activePlayCallId else { return }
        activePlayCallId = nil
        guard let call = bridge?.savedCall(withID: callId) else { return }
        call.resolve([
            "ok": true,
        ])
        bridge?.releaseCall(call)
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let rawAudioBase64 = call.getString("audioBase64"), !rawAudioBase64.isEmpty else {
            call.reject("audioBase64 is required")
            return
        }

        let cleanedAudioBase64: String
        if let range = rawAudioBase64.range(of: "base64,") {
            cleanedAudioBase64 = String(rawAudioBase64[range.upperBound...])
        } else {
            cleanedAudioBase64 = rawAudioBase64
        }

        guard let audioData = Data(base64Encoded: cleanedAudioBase64, options: [.ignoreUnknownCharacters]), !audioData.isEmpty else {
            call.reject("Invalid base64 audio payload")
            return
        }

        // Keep only one active playback call at a time.
        rejectActivePlayCall("native_tts_interrupted")
        clearActivePlayback()

        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.allowBluetoothA2DP, .mixWithOthers]
            )
            try session.setActive(true, options: [])

            let player = try AVAudioPlayer(data: audioData)
            player.delegate = self
            player.prepareToPlay()
            let didStart = player.play()
            if !didStart {
                call.reject("Failed to start native playback")
                return
            }

            audioPlayer = player
            bridge?.saveCall(call)
            activePlayCallId = call.callbackId
            NSLog("[NativeTTSPlayer] play started route=%@", String(describing: session.currentRoute.outputs.first?.portType.rawValue))
        } catch {
            clearActivePlayback()
            call.reject("Failed to play native TTS audio", nil, error)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        clearActivePlayback()
        rejectActivePlayCall("native_tts_stopped")
        call.resolve()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        clearActivePlayback()
        if flag {
            resolveActivePlayCall()
        } else {
            rejectActivePlayCall("Native playback finished unsuccessfully")
        }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        clearActivePlayback()
        if let decodeError = error {
            rejectActivePlayCall("Native decode error: \(decodeError.localizedDescription)")
        } else {
            rejectActivePlayCall("Native decode error")
        }
    }
}

@objc(NativeSTTPlugin)
class NativeSTTPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSTTPlugin"
    public let jsName = "NativeSTT"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let audioEngine = AVAudioEngine()
    private let wsQueue = DispatchQueue(label: "NativeSTT.wsQueue")
    private var webSocketSession: URLSession?
    private var socketTask: URLSessionWebSocketTask?
    private var hasInputTap = false
    private var isRunning = false

    private func notifyOnMain(_ event: String, data: [String: Any]) {
        DispatchQueue.main.async {
            self.notifyListeners(event, data: data)
        }
    }

    private func emitError(_ message: String) {
        NSLog("[NativeSTT] error=%@", message)
        notifyOnMain("error", data: [
            "message": message,
        ])
    }

    private func emitMessage(raw: String) {
        notifyOnMain("message", data: [
            "raw": raw,
        ])
    }

    private func emitStatus(_ status: String) {
        notifyOnMain("status", data: [
            "status": status,
        ])
    }

    private func emitClose(_ reason: String) {
        notifyOnMain("close", data: [
            "reason": reason,
        ])
    }

    private func removeTapIfNeeded() {
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
    }

    private func stopAndCleanup(notifyClose reason: String? = nil) {
        isRunning = false
        removeTapIfNeeded()
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        if let task = socketTask {
            task.cancel(with: .goingAway, reason: nil)
        }
        socketTask = nil

        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil

        if let closeReason = reason {
            emitClose(closeReason)
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
                guard let self = self else { return }
                if let error = error, self.isRunning {
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
            guard let self = self else { return }
            guard self.isRunning else { return }
            switch result {
            case .failure(let error):
                self.emitError("ws_receive_failed: \(error.localizedDescription)")
                self.stopAndCleanup(notifyClose: "receive_failed")
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
        if frameLength == 0 { return nil }

        var pcmData = Data(capacity: frameLength * MemoryLayout<Int16>.size)
        for i in 0..<frameLength {
            let sample = max(-1.0, min(1.0, channelData[i]))
            var intSample = Int16(sample < 0 ? sample * 32768.0 : sample * 32767.0)
            withUnsafeBytes(of: &intSample) { bytes in
                pcmData.append(contentsOf: bytes)
            }
        }
        return pcmData.base64EncodedString()
    }

    private func startSession(
        call: CAPPluginCall,
        wsUrl: URL,
        wsUrlString: String,
        languages: [String],
        sttModel: String,
        langHintsStrict: Bool
    ) {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
            )
            try audioSession.setActive(true, options: [])
        } catch {
            call.reject("Failed to configure AVAudioSession", nil, error)
            return
        }

        removeTapIfNeeded()
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        let sampleRate = Int(inputFormat.sampleRate.rounded())

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration)
        let task = session.webSocketTask(with: wsUrl)
        webSocketSession = session
        socketTask = task

        isRunning = true
        task.resume()
        receiveLoop()

        inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self else { return }
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

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            stopAndCleanup()
            call.reject("Failed to start AVAudioEngine", nil, error)
            return
        }

        sendJson([
            "sample_rate": sampleRate,
            "languages": languages,
            "stt_model": sttModel,
            "lang_hints_strict": langHintsStrict,
        ])

        NSLog("[NativeSTT] started sampleRate=%d ws=%@", sampleRate, wsUrlString)
        call.resolve([
            "sampleRate": sampleRate,
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        if isRunning {
            call.reject("native_stt_already_running")
            return
        }

        guard let wsUrlString = call.getString("wsUrl"), let wsUrl = URL(string: wsUrlString) else {
            call.reject("Invalid wsUrl")
            return
        }

        let languages = call.getArray("languages", String.self) ?? []
        let sttModel = call.getString("sttModel") ?? "soniox"
        let langHintsStrict = call.getBool("langHintsStrict") ?? true

        let audioSession = AVAudioSession.sharedInstance()
        switch audioSession.recordPermission {
        case .granted:
            startSession(
                call: call,
                wsUrl: wsUrl,
                wsUrlString: wsUrlString,
                languages: languages,
                sttModel: sttModel,
                langHintsStrict: langHintsStrict
            )
        case .denied:
            emitError("mic_permission_denied")
            call.reject("Microphone permission denied")
        case .undetermined:
            audioSession.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if granted {
                        self.startSession(
                            call: call,
                            wsUrl: wsUrl,
                            wsUrlString: wsUrlString,
                            languages: languages,
                            sttModel: sttModel,
                            langHintsStrict: langHintsStrict
                        )
                        return
                    }
                    self.emitError("mic_permission_denied_after_prompt")
                    call.reject("Microphone permission denied")
                }
            }
        @unknown default:
            emitError("mic_permission_unknown_state")
            call.reject("Unknown microphone permission state")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        let pendingText = call.getString("pendingText") ?? ""
        let pendingLanguage = call.getString("pendingLanguage") ?? "unknown"

        if isRunning {
            sendJson([
                "type": "stop_recording",
                "data": [
                    "pending_text": pendingText,
                    "pending_language": pendingLanguage,
                ],
            ])
        }

        stopAndCleanup(notifyClose: "stopped")
        NSLog("[NativeSTT] stopped")
        call.resolve()
    }
}
