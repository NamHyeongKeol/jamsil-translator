package com.rnnative

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.max

class NativeSTTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private data class StartConfig(
        val wsUrl: String,
        val languages: List<String>,
        val sttModel: String,
        val langHintsStrict: Boolean,
    )

    private val stateLock = Any()

    @Volatile
    private var hasListeners = false

    @Volatile
    private var isRunning = false

    @Volatile
    private var stopRequested = false

    @Volatile
    private var isAecEnabled = false

    @Volatile
    private var currentSampleRate = 48_000

    @Volatile
    private var audioChunkCount: Long = 0

    @Volatile
    private var wsMessageCount: Long = 0

    private var webSocket: WebSocket? = null
    private var webSocketClient: OkHttpClient? = null
    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    private var acousticEchoCanceler: AcousticEchoCanceler? = null
    private var permissionListener: PermissionListener? = null
    private var pendingStartPromise: Promise? = null
    private var startConfig: StartConfig? = null

    override fun getName(): String = "NativeSTTModule"

    @ReactMethod
    fun addListener(eventName: String) {
        hasListeners = true
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        if (count > 0) {
            hasListeners = false
        }
    }

    private fun emit(eventName: String, payload: WritableMap) {
        if (!hasListeners) return
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    private fun emitStatus(status: String) {
        val payload = Arguments.createMap()
        payload.putString("status", status)
        emit("status", payload)
    }

    private fun emitMessage(raw: String) {
        val payload = Arguments.createMap()
        payload.putString("raw", raw)
        emit("message", payload)
    }

    private fun emitError(message: String) {
        val payload = Arguments.createMap()
        payload.putString("message", message)
        emit("error", payload)
    }

    private fun emitClose(reason: String) {
        val payload = Arguments.createMap()
        payload.putString("reason", reason)
        emit("close", payload)
    }

    private fun parseStringArray(array: ReadableArray?): List<String> {
        if (array == null) return emptyList()
        val values = mutableListOf<String>()
        for (index in 0 until array.size()) {
            val raw = array.getString(index)?.trim().orEmpty()
            if (raw.isNotEmpty()) {
                values.add(raw)
            }
        }
        return values
    }

    private fun readableString(map: ReadableMap, key: String): String? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        return map.getString(key)
    }

    private fun readableBoolean(map: ReadableMap, key: String, defaultValue: Boolean): Boolean {
        if (!map.hasKey(key) || map.isNull(key)) return defaultValue
        return map.getBoolean(key)
    }

    private fun readableArray(map: ReadableMap, key: String): ReadableArray? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        return map.getArray(key)
    }

    private fun ensureMicrophonePermission(onGranted: () -> Unit, onDenied: (String) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            onGranted()
            return
        }
        if (
            ContextCompat.checkSelfPermission(
                reactContext,
                Manifest.permission.RECORD_AUDIO,
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            onGranted()
            return
        }

        UiThreadUtil.runOnUiThread {
            val activity = reactContext.currentActivity
            val permissionAwareActivity = activity as? PermissionAwareActivity
            if (permissionAwareActivity == null) {
                onDenied("mic_permission_activity_unavailable")
                return@runOnUiThread
            }

            val listener = PermissionListener { requestCode, _, grantResults ->
                if (requestCode != MIC_PERMISSION_REQUEST_CODE) return@PermissionListener false
                permissionListener = null
                val granted = grantResults.isNotEmpty() &&
                    grantResults[0] == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    onGranted()
                } else {
                    onDenied("mic_permission_denied")
                }
                true
            }

            permissionListener = listener
            permissionAwareActivity.requestPermissions(
                arrayOf(Manifest.permission.RECORD_AUDIO),
                MIC_PERMISSION_REQUEST_CODE,
                listener,
            )
        }
    }

    private fun resolveSampleRate(): Int {
        val candidates = intArrayOf(48_000, 44_100, 32_000, 16_000)
        for (candidate in candidates) {
            val minBuffer = AudioRecord.getMinBufferSize(
                candidate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuffer > 0) {
                return candidate
            }
        }
        return 16_000
    }

    private fun releaseAecIfNeeded() {
        try {
            acousticEchoCanceler?.release()
        } catch (_: Throwable) {
            // best effort
        } finally {
            acousticEchoCanceler = null
        }
    }

    private fun configureAec(audioRecordInstance: AudioRecord) {
        releaseAecIfNeeded()
        if (!AcousticEchoCanceler.isAvailable()) return
        try {
            val effect = AcousticEchoCanceler.create(audioRecordInstance.audioSessionId)
            effect?.enabled = isAecEnabled
            acousticEchoCanceler = effect
        } catch (_: Throwable) {
            releaseAecIfNeeded()
        }
    }

    private fun sendJson(payload: JSONObject): Boolean {
        val text = payload.toString()
        val ws = synchronized(stateLock) { webSocket }
        if (!isRunning || ws == null) return false
        val sent = ws.send(text)
        if (!sent && !stopRequested) {
            emitError("ws_send_failed")
        }
        return sent
    }

    private fun sendStartConfig(config: StartConfig, sampleRate: Int): Boolean {
        val payload = JSONObject()
            .put("sample_rate", sampleRate)
            .put("languages", config.languages)
            .put("stt_model", config.sttModel)
            .put("lang_hints_strict", config.langHintsStrict)
        return sendJson(payload)
    }

    private fun sendAudioChunk(bytes: ByteArray, length: Int) {
        val base64 = Base64.encodeToString(bytes, 0, length, Base64.NO_WRAP)
        val payload = JSONObject()
            .put("type", "audio_chunk")
            .put(
                "data",
                JSONObject().put("chunk", base64),
            )
        sendJson(payload)
    }

    private fun stopAudioCapture() {
        val localAudioThread = synchronized(stateLock) {
            val thread = audioThread
            audioThread = null
            thread
        }
        val localRecorder = synchronized(stateLock) {
            val recorder = audioRecord
            audioRecord = null
            recorder
        }

        if (localAudioThread != null) {
            localAudioThread.interrupt()
        }

        try {
            localRecorder?.stop()
        } catch (_: IllegalStateException) {
            // best effort
        }
        try {
            localRecorder?.release()
        } catch (_: Throwable) {
            // best effort
        }

        releaseAecIfNeeded()

        if (localAudioThread != null && localAudioThread !== Thread.currentThread()) {
            try {
                localAudioThread.join(250)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    private fun startAudioCapture(): Boolean {
        stopAudioCapture()

        val sampleRate = resolveSampleRate()
        val minBufferSize = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBufferSize <= 0) {
            emitError("audio_record_buffer_size_invalid")
            return false
        }

        val targetBufferSize = max(minBufferSize * 2, sampleRate / 5)
        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                targetBufferSize,
            )
        } catch (error: Throwable) {
            emitError("audio_record_init_failed: ${error.message ?: "unknown"}")
            return false
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            emitError("audio_record_not_initialized")
            return false
        }

        synchronized(stateLock) {
            audioRecord = recorder
            currentSampleRate = sampleRate
            audioChunkCount = 0
        }

        configureAec(recorder)

        try {
            recorder.startRecording()
        } catch (error: Throwable) {
            recorder.release()
            synchronized(stateLock) {
                audioRecord = null
            }
            emitError("audio_record_start_failed: ${error.message ?: "unknown"}")
            return false
        }

        val thread = Thread({
            val readBuffer = ByteArray(4096)
            while (isRunning && !Thread.currentThread().isInterrupted) {
                val readBytes = recorder.read(readBuffer, 0, readBuffer.size)
                if (readBytes > 0) {
                    audioChunkCount += 1
                    sendAudioChunk(readBuffer, readBytes)
                } else if (readBytes < 0 && isRunning && !stopRequested) {
                    emitError("audio_read_failed:$readBytes")
                    break
                }
            }
        }, "NativeSTT-AudioThread")

        synchronized(stateLock) {
            audioThread = thread
        }
        thread.start()
        return true
    }

    private fun resolvePendingStart(sampleRate: Int) {
        val promise = synchronized(stateLock) {
            val target = pendingStartPromise
            pendingStartPromise = null
            target
        } ?: return
        val result = Arguments.createMap()
        result.putInt("sampleRate", sampleRate)
        promise.resolve(result)
    }

    private fun rejectPendingStart(code: String, message: String, throwable: Throwable? = null) {
        val promise = synchronized(stateLock) {
            val target = pendingStartPromise
            pendingStartPromise = null
            target
        } ?: return
        promise.reject(code, message, throwable)
    }

    private fun shutdownClient(client: OkHttpClient?) {
        if (client == null) return
        try {
            client.dispatcher.executorService.shutdown()
        } catch (_: Throwable) {
            // best effort
        }
        try {
            client.connectionPool.evictAll()
        } catch (_: Throwable) {
            // best effort
        }
    }

    private fun stopAndCleanup(reason: String?, emitCloseEvent: Boolean) {
        val localWs: WebSocket?
        val localClient: OkHttpClient?
        synchronized(stateLock) {
            localWs = webSocket
            webSocket = null
            localClient = webSocketClient
            webSocketClient = null
            isRunning = false
            startConfig = null
        }

        stopAudioCapture()

        try {
            localWs?.close(1001, reason ?: "closed")
            localWs?.cancel()
        } catch (_: Throwable) {
            // best effort
        }

        shutdownClient(localClient)

        if (emitCloseEvent && reason != null) {
            emitClose(reason)
        }
    }

    private fun restartAudioCaptureForAecToggle(promise: Promise) {
        if (!isRunning) {
            val result = Arguments.createMap()
            result.putBoolean("ok", true)
            promise.resolve(result)
            return
        }

        if (!startAudioCapture()) {
            promise.reject("audio_engine", "Failed to restart after AEC toggle")
            return
        }

        val result = Arguments.createMap()
        result.putBoolean("ok", true)
        promise.resolve(result)
    }

    private fun createWebSocketListener(config: StartConfig): WebSocketListener {
        return object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!isRunning) {
                    webSocket.close(1001, "stopped")
                    return
                }

                wsMessageCount = 0

                if (!startAudioCapture()) {
                    rejectPendingStart("audio_engine", "Failed to start AudioRecord")
                    stopAndCleanup("audio_start_failed", emitCloseEvent = true)
                    return
                }

                if (!sendStartConfig(config, currentSampleRate)) {
                    rejectPendingStart("ws_send_failed", "Failed to send STT start config")
                    stopAndCleanup("ws_send_failed", emitCloseEvent = true)
                    return
                }

                emitStatus("running")
                resolvePendingStart(currentSampleRate)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!isRunning) return
                wsMessageCount += 1
                emitMessage(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (!isRunning) return
                wsMessageCount += 1
                emitMessage(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!isRunning) return
                val message = t.message ?: "unknown"
                if (!stopRequested) {
                    emitError("ws_failure: $message")
                }
                rejectPendingStart("ws_failure", message, t)
                stopAndCleanup("failure", emitCloseEvent = true)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!isRunning) return
                if (stopRequested) return
                val closeReason = if (reason.isBlank()) "closed_$code" else reason
                rejectPendingStart("ws_closed", closeReason)
                stopAndCleanup(closeReason, emitCloseEvent = true)
            }
        }
    }

    @ReactMethod
    fun start(options: ReadableMap, promise: Promise) {
        synchronized(stateLock) {
            if (isRunning) {
                promise.reject("already_running", "native_stt_already_running")
                return
            }
            if (pendingStartPromise != null) {
                promise.reject("already_starting", "native_stt_already_starting")
                return
            }
        }

        val wsUrl = readableString(options, "wsUrl")?.trim().orEmpty()
        if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
            promise.reject("invalid_ws_url", "Invalid wsUrl")
            return
        }

        val languages = parseStringArray(
            readableArray(options, "languages"),
        ).ifEmpty { listOf("ko", "en", "th") }

        val sttModel = readableString(options, "sttModel")?.trim().orEmpty().ifEmpty { "soniox" }
        val langHintsStrict = readableBoolean(options, "langHintsStrict", true)
        val aecEnabled = readableBoolean(options, "aecEnabled", false)

        ensureMicrophonePermission(
            onGranted = {
                synchronized(stateLock) {
                    isRunning = true
                    stopRequested = false
                    isAecEnabled = aecEnabled
                    pendingStartPromise = promise
                    startConfig = StartConfig(
                        wsUrl = wsUrl,
                        languages = languages,
                        sttModel = sttModel,
                        langHintsStrict = langHintsStrict,
                    )
                }

                emitStatus("connecting")

                val client = OkHttpClient.Builder()
                    .retryOnConnectionFailure(true)
                    .pingInterval(15, TimeUnit.SECONDS)
                    .build()
                val request = Request.Builder().url(wsUrl).build()

                synchronized(stateLock) {
                    webSocketClient = client
                }

                val socket = client.newWebSocket(request, createWebSocketListener(startConfig!!))
                synchronized(stateLock) {
                    webSocket = socket
                }
            },
            onDenied = { reason ->
                emitError(reason)
                promise.reject("mic_permission", reason)
            },
        )
    }

    @ReactMethod
    fun stop(options: ReadableMap?, promise: Promise) {
        val pendingText = if (options != null) readableString(options, "pendingText")?.trim().orEmpty() else ""
        val pendingLanguage = if (options != null) {
            readableString(options, "pendingLanguage")?.trim().orEmpty().ifEmpty { "unknown" }
        } else {
            "unknown"
        }

        stopRequested = true

        if (isRunning) {
            sendJson(
                JSONObject()
                    .put("type", "stop_recording")
                    .put(
                        "data",
                        JSONObject()
                            .put("pending_text", pendingText)
                            .put("pending_language", pendingLanguage),
                    ),
            )
        }

        rejectPendingStart("stopped", "native_stt_stopped")
        stopAndCleanup("stopped", emitCloseEvent = true)
        emitStatus("stopped")

        stopRequested = false

        val result = Arguments.createMap()
        result.putBoolean("ok", true)
        promise.resolve(result)
    }

    @ReactMethod
    fun setAec(enabled: Boolean, promise: Promise) {
        isAecEnabled = enabled
        restartAudioCaptureForAecToggle(promise)
    }

    override fun invalidate() {
        stopRequested = true
        rejectPendingStart("invalidated", "native_stt_module_invalidated")
        stopAndCleanup("invalidated", emitCloseEvent = false)
        stopRequested = false
        super.invalidate()
    }

    companion object {
        private const val MIC_PERMISSION_REQUEST_CODE = 7134
    }
}
