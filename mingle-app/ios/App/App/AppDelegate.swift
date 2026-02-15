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
