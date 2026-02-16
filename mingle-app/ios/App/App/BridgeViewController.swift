import Capacitor
import UIKit

class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeAudioSessionPlugin())
        bridge?.registerPluginInstance(NativeTTSPlayerPlugin())
        bridge?.registerPluginInstance(NativeSTTPlugin())
    }
}

