package com.minglelabs.mingle.rn

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class NativeSTTModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private data class StartOptions(
    val wsUrl: String,
    val languages: List<String>,
    val sttModel: String,
    val langHintsStrict: Boolean,
    val aecEnabled: Boolean,
  )

  private data class PendingStartRequest(
    val options: StartOptions,
    val promise: Promise,
  )

  private data class AudioCaptureHandle(
    val record: AudioRecord,
    val sampleRate: Int,
    val bufferSizeInBytes: Int,
    val profile: NativeSttCaptureProfile,
  )

  private val audioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val isRunning = AtomicBoolean(false)

  @Volatile private var hasListeners = false
  @Volatile private var webSocketReady = false
  @Volatile private var audioRecord: AudioRecord? = null
  @Volatile private var audioThread: Thread? = null
  @Volatile private var webSocket: WebSocket? = null
  @Volatile private var webSocketClient: OkHttpClient? = null
  @Volatile private var currentSampleRate: Int = 48_000
  @Volatile private var requestedAecEnabled = false
  @Volatile private var currentProfile: NativeSttCaptureProfile? = null
  @Volatile private var previousAudioMode: Int? = null
  @Volatile private var activeEchoCanceler: AcousticEchoCanceler? = null
  @Volatile private var activeNoiseSuppressor: NoiseSuppressor? = null
  @Volatile private var pendingStartRequest: PendingStartRequest? = null
  @Volatile private var recordingCallback: AudioManager.AudioRecordingCallback? = null
  @Volatile private var lastClientSilenced: Boolean? = null

  override fun getName(): String = "NativeSTTModule"

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    cleanup(reason = null, emitClose = false)
    super.invalidate()
  }

  @ReactMethod
  fun addListener(eventName: String) {
    hasListeners = true
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    if (count > 0) {
      hasListeners = false
    }
  }

  @ReactMethod
  fun start(
    options: ReadableMap,
    promise: Promise,
  ) {
    if (isRunning.get()) {
      promise.reject("already_running", "native_stt_already_running")
      return
    }

    val wsUrl = options.getString("wsUrl")?.trim().orEmpty()
    if (wsUrl.isEmpty()) {
      promise.reject("invalid_ws_url", "Invalid wsUrl")
      return
    }

    val languages = mutableListOf<String>()
    if (options.hasKey("languages") && !options.isNull("languages")) {
      val raw = options.getArray("languages")
      if (raw != null) {
        for (index in 0 until raw.size()) {
          val value = raw.getString(index)?.trim().orEmpty()
          if (value.isNotEmpty()) {
            languages.add(value)
          }
        }
      }
    }

    val startOptions = StartOptions(
      wsUrl = wsUrl,
      languages = languages,
      sttModel = options.getString("sttModel")?.trim().orEmpty().ifEmpty { "soniox" },
      langHintsStrict = if (options.hasKey("langHintsStrict")) options.getBoolean("langHintsStrict") else true,
      aecEnabled = if (options.hasKey("aecEnabled")) options.getBoolean("aecEnabled") else false,
    )

    if (hasRecordAudioPermission()) {
      startSession(startOptions, promise)
      return
    }

    val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      emitError("mic_permission_activity_unavailable")
      promise.reject("mic_permission", "Microphone permission activity unavailable")
      return
    }

    pendingStartRequest = PendingStartRequest(startOptions, promise)
    activity.requestPermissions(
      arrayOf(Manifest.permission.RECORD_AUDIO),
      REQUEST_RECORD_AUDIO,
      permissionListener,
    )
  }

  @ReactMethod
  fun stop(
    options: ReadableMap?,
    promise: Promise,
  ) {
    val pendingText = options?.getString("pendingText")?.takeIf { it.isNotBlank() } ?: ""
    val pendingLanguage = options?.getString("pendingLanguage")?.takeIf { it.isNotBlank() } ?: "unknown"

    val currentSocket = webSocket
    if (isRunning.get() && currentSocket != null && webSocketReady) {
      currentSocket.send(
        JSONObject()
          .put("type", "stop_recording")
          .put(
            "data",
            JSONObject()
              .put("pending_text", pendingText)
              .put("pending_language", pendingLanguage),
          )
          .toString(),
      )
    }

    cleanup(reason = "stopped", emitClose = true)
    emitStatus("stopped")
    promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
  }

  @ReactMethod
  fun setAec(
    enabled: Boolean,
    promise: Promise,
  ) {
    requestedAecEnabled = enabled
    val running = isRunning.get()
    if (!running) {
      promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
      return
    }

    try {
      recreateAudioCapture(enabled)
      promise.resolve(Arguments.createMap().apply { putBoolean("ok", true) })
    } catch (error: Throwable) {
      emitError("audio_reconfigure_failed: ${error.message ?: "unknown"}")
      promise.reject("audio_reconfigure", "Failed to reconfigure native STT capture", error)
    }
  }

  private val permissionListener =
    PermissionListener { requestCode, _, grantResults ->
      if (requestCode != REQUEST_RECORD_AUDIO) {
        return@PermissionListener false
      }

      val pending = pendingStartRequest
      pendingStartRequest = null
      if (pending == null) {
        return@PermissionListener true
      }

      val granted = grantResults.isNotEmpty() &&
        grantResults.all { it == PackageManager.PERMISSION_GRANTED }

      if (!granted) {
        emitError("mic_permission_denied_after_prompt")
        pending.promise.reject("mic_permission", "Microphone permission denied")
        return@PermissionListener true
      }

      UiThreadUtil.runOnUiThread {
        startSession(pending.options, pending.promise)
      }
      true
    }

  private fun startSession(
    options: StartOptions,
    promise: Promise,
  ) {
    if (isRunning.get()) {
      promise.reject("already_running", "native_stt_already_running")
      return
    }

    requestedAecEnabled = options.aecEnabled
    val profile = NativeSttCapturePolicy.resolve(options.aecEnabled)

    try {
      prepareAudioMode(profile)
      if (profile.foregroundServiceEnabled) {
        NativeSTTForegroundService.start(reactApplicationContext)
      }

      val capture = createAudioCapture(
        profile = profile,
        preferredSampleRate = null,
      )
      audioRecord = capture.record
      currentSampleRate = capture.sampleRate
      currentProfile = capture.profile
      attachAudioEffects(capture.record.audioSessionId, capture.profile)
      registerRecordingCallback(capture.record)

      val socketClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
      webSocketClient = socketClient
      webSocketReady = false
      lastClientSilenced = null

      val request = Request.Builder()
        .url(options.wsUrl)
        .build()

      emitStatus("connecting")
      isRunning.set(true)

      webSocket = socketClient.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          webSocketReady = true
          val config = JSONObject()
            .put("sample_rate", currentSampleRate)
            .put("languages", JSONArray(options.languages))
            .put("stt_model", options.sttModel)
            .put("lang_hints_strict", options.langHintsStrict)
          webSocket.send(config.toString())
          Log.i(TAG, "ws opened sampleRate=$currentSampleRate profile=${profile.label}")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          emitMessage(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          if (!isRunning.get()) {
            return
          }
          emitClose(reason.ifBlank { "socket_closing" })
          cleanup(reason = null, emitClose = false)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (!isRunning.get()) {
            return
          }
          emitClose(reason.ifBlank { "socket_closed" })
          cleanup(reason = null, emitClose = false)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (!isRunning.get()) {
            return
          }
          emitError("ws_failure: ${t.message ?: "unknown"}")
          cleanup(reason = "socket_failure", emitClose = true)
        }
      })

      startAudioThread(capture)
      emitStatus("running")
      promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", currentSampleRate)
      })
    } catch (error: Throwable) {
      cleanup(reason = null, emitClose = false)
      emitError("native_stt_start_failed: ${error.message ?: "unknown"}")
      promise.reject("native_stt_start", "Failed to start native STT", error)
    }
  }

  private fun recreateAudioCapture(
    aecEnabled: Boolean,
  ) {
    val current = audioRecord ?: throw IllegalStateException("audio_record_unavailable")
    val preferredSampleRate = currentSampleRate
    val profile = NativeSttCapturePolicy.resolve(aecEnabled)
    stopAudioThread()
    unregisterRecordingCallback()
    releaseAudioEffects()
    current.stopSafely()
    current.release()

    prepareAudioMode(profile)
    val capture = createAudioCapture(
      profile = profile,
      preferredSampleRate = preferredSampleRate,
    )
    audioRecord = capture.record
    currentSampleRate = capture.sampleRate
    currentProfile = capture.profile
    attachAudioEffects(capture.record.audioSessionId, capture.profile)
    registerRecordingCallback(capture.record)
    startAudioThread(capture)
    emitStatus("running")
  }

  private fun prepareAudioMode(
    profile: NativeSttCaptureProfile,
  ) {
    if (previousAudioMode == null) {
      previousAudioMode = audioManager.mode
    }
    audioManager.mode = profile.audioMode
  }

  private fun restoreAudioMode() {
    val restoreMode = previousAudioMode ?: return
    audioManager.mode = restoreMode
    previousAudioMode = null
  }

  private fun createAudioCapture(
    profile: NativeSttCaptureProfile,
    preferredSampleRate: Int?,
  ): AudioCaptureHandle {
    var lastError: String? = null

    for (sampleRate in NativeSttCapturePolicy.preferredSampleRates(preferredSampleRate)) {
      val minBuffer = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBuffer <= 0) {
        lastError = "invalid_min_buffer($sampleRate,$minBuffer)"
        continue
      }

      val bufferSizeInBytes = max(minBuffer * 2, sampleRate / 5)
      val format = AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(sampleRate)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
        .build()

      try {
        val builder = AudioRecord.Builder()
          .setAudioSource(profile.audioSource)
          .setAudioFormat(format)
          .setBufferSizeInBytes(bufferSizeInBytes)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          builder.setPrivacySensitive(profile.privacySensitive)
        }
        val record = builder.build()
        if (record.state == AudioRecord.STATE_INITIALIZED) {
          Log.i(
            TAG,
            "audio record ready rate=$sampleRate source=${profile.audioSource} privacy=${profile.privacySensitive} profile=${profile.label}",
          )
          return AudioCaptureHandle(record, sampleRate, bufferSizeInBytes, profile)
        }
        record.release()
        lastError = "audio_record_state_${record.state}"
      } catch (error: Throwable) {
        lastError = error.message ?: error.javaClass.simpleName
      }
    }

    throw IllegalStateException("audio_record_init_failed(${lastError ?: "unknown"})")
  }

  private fun startAudioThread(
    capture: AudioCaptureHandle,
  ) {
    val record = capture.record
    val chunkBuffer = ByteArray(2_048 * 2)
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      throw IllegalStateException("audio_record_start_failed(${record.recordingState})")
    }

    val thread = Thread({
      while (isRunning.get() && audioRecord === record) {
        val bytesRead = record.read(chunkBuffer, 0, chunkBuffer.size)
        if (bytesRead <= 0) {
          if (bytesRead != AudioRecord.ERROR_INVALID_OPERATION && bytesRead != AudioRecord.ERROR_BAD_VALUE) {
            emitError("audio_read_failed: $bytesRead")
          }
          continue
        }

        val socket = webSocket
        if (!webSocketReady || socket == null) {
          continue
        }

        val encoded = Base64.encodeToString(chunkBuffer, 0, bytesRead, Base64.NO_WRAP)
        val payload = JSONObject()
          .put("type", "audio_chunk")
          .put(
            "data",
            JSONObject().put("chunk", encoded),
          )
        socket.send(payload.toString())
      }
    }, "NativeSTT-Audio")
    thread.isDaemon = true
    audioThread = thread
    thread.start()
  }

  private fun stopAudioThread() {
    val thread = audioThread
    audioThread = null
    if (thread != null && thread.isAlive) {
      thread.interrupt()
      try {
        thread.join(300)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
  }

  private fun attachAudioEffects(
    sessionId: Int,
    profile: NativeSttCaptureProfile,
  ) {
    releaseAudioEffects()

    if (AcousticEchoCanceler.isAvailable()) {
      activeEchoCanceler = AcousticEchoCanceler.create(sessionId)?.apply {
        enabled = profile.aecEnabled
      }
    }

    if (NoiseSuppressor.isAvailable()) {
      activeNoiseSuppressor = NoiseSuppressor.create(sessionId)?.apply {
        enabled = profile.noiseSuppressorEnabled
      }
    }
  }

  private fun releaseAudioEffects() {
    activeEchoCanceler?.release()
    activeNoiseSuppressor?.release()
    activeEchoCanceler = null
    activeNoiseSuppressor = null
  }

  private fun registerRecordingCallback(
    record: AudioRecord,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return
    }
    unregisterRecordingCallback()
    val callback = object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<android.media.AudioRecordingConfiguration>) {
        val matching = configs.firstOrNull { it.clientAudioSessionId == record.audioSessionId } ?: return
        val silenced = matching.isClientSilenced
        val previous = lastClientSilenced
        if (previous == silenced) {
          return
        }
        lastClientSilenced = silenced
        emitStatus(if (silenced) "silenced" else "running")
      }
    }
    recordingCallback = callback
    audioManager.registerAudioRecordingCallback(
      callback,
      null,
    )
  }

  private fun unregisterRecordingCallback() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return
    }
    val callback = recordingCallback ?: return
    audioManager.unregisterAudioRecordingCallback(callback)
    recordingCallback = null
    lastClientSilenced = null
  }

  private fun cleanup(
    reason: String?,
    emitClose: Boolean,
  ) {
    val wasRunning = isRunning.getAndSet(false)
    webSocketReady = false

    val socket = webSocket
    webSocket = null
    socket?.cancel()

    webSocketClient?.dispatcher?.executorService?.shutdown()
    webSocketClient?.connectionPool?.evictAll()
    webSocketClient = null

    stopAudioThread()
    unregisterRecordingCallback()
    releaseAudioEffects()

    val record = audioRecord
    audioRecord = null
    if (record != null) {
      record.stopSafely()
      record.release()
    }

    restoreAudioMode()

    if (currentProfile?.foregroundServiceEnabled == true) {
      NativeSTTForegroundService.stop(reactApplicationContext)
    }
    currentProfile = null

    if (emitClose && wasRunning && reason != null) {
      emitClose(reason)
    }
  }

  private fun emitStatus(status: String) {
    emitEvent(
      "status",
      Arguments.createMap().apply {
        putString("status", status)
      },
    )
  }

  private fun emitMessage(raw: String) {
    emitEvent(
      "message",
      Arguments.createMap().apply {
        putString("raw", raw)
      },
    )
  }

  private fun emitError(message: String) {
    Log.e(TAG, message)
    emitEvent(
      "error",
      Arguments.createMap().apply {
        putString("message", message)
      },
    )
  }

  private fun emitClose(reason: String) {
    emitEvent(
      "close",
      Arguments.createMap().apply {
        putString("reason", reason)
      },
    )
  }

  private fun emitEvent(
    eventName: String,
    payload: com.facebook.react.bridge.WritableMap,
  ) {
    if (!hasListeners) {
      return
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun hasRecordAudioPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED

  override fun onHostResume() {
    // Background capture is intentionally allowed while STT is active.
  }

  override fun onHostPause() {
    // Keep recording active; foreground service + capture policy own the lifetime.
  }

  override fun onHostDestroy() {
    cleanup(reason = "host_destroyed", emitClose = true)
  }

  private fun AudioRecord.stopSafely() {
    try {
      if (recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        stop()
      }
    } catch (_: IllegalStateException) {
      // Ignore stop races during teardown.
    }
  }

  companion object {
    private const val TAG = "NativeSTTModule"
    private const val REQUEST_RECORD_AUDIO = 44_002
  }
}
