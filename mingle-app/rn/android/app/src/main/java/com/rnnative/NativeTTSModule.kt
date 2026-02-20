package com.rnnative

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import java.io.File
import java.util.UUID

class NativeTTSModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    @Volatile
    private var hasListeners = false

    private var mediaPlayer: MediaPlayer? = null
    private var currentPlaybackId: String? = null
    private var currentUtteranceId: String? = null
    private var currentAudioFile: File? = null

    override fun getName(): String = "NativeTTSModule"

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

    private fun buildIdentityPayload(base: WritableMap? = null): WritableMap {
        val payload = base ?: Arguments.createMap()
        val playbackId = currentPlaybackId
        val utteranceId = currentUtteranceId
        if (!playbackId.isNullOrBlank()) {
            payload.putString("playbackId", playbackId)
        }
        if (!utteranceId.isNullOrBlank()) {
            payload.putString("utteranceId", utteranceId)
        }
        return payload
    }

    private fun readableString(map: ReadableMap, key: String): String? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        return map.getString(key)
    }

    private fun deleteCurrentAudioFile() {
        val file = currentAudioFile
        currentAudioFile = null
        if (file != null && file.exists()) {
            runCatching { file.delete() }
        }
    }

    private fun releasePlayer(emitStoppedEvent: Boolean) {
        val player = mediaPlayer
        val wasPlaying = player?.isPlaying == true
        if (player != null) {
            try {
                if (player.isPlaying) {
                    player.stop()
                }
            } catch (_: Throwable) {
                // best effort
            }
            try {
                player.reset()
            } catch (_: Throwable) {
                // best effort
            }
            try {
                player.release()
            } catch (_: Throwable) {
                // best effort
            }
        }
        mediaPlayer = null

        if (emitStoppedEvent && wasPlaying) {
            emit("ttsPlaybackStopped", buildIdentityPayload())
        }

        currentPlaybackId = null
        currentUtteranceId = null
        deleteCurrentAudioFile()
    }

    @ReactMethod
    fun play(options: ReadableMap, promise: Promise) {
        val audioBase64 = readableString(options, "audioBase64")?.trim().orEmpty()
        if (audioBase64.isEmpty()) {
            promise.reject("decode_error", "Failed to decode base64 audio data")
            return
        }

        val rawPlaybackId = readableString(options, "playbackId")?.trim().orEmpty()
        val rawUtteranceId = readableString(options, "utteranceId")?.trim().orEmpty()
        val playbackId = when {
            rawPlaybackId.isNotEmpty() -> rawPlaybackId
            rawUtteranceId.isNotEmpty() -> rawUtteranceId
            else -> UUID.randomUUID().toString()
        }
        val utteranceId = rawUtteranceId.ifEmpty { null }

        val decodedAudio = try {
            Base64.decode(audioBase64, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            promise.reject("decode_error", "Failed to decode base64 audio data", error)
            return
        }

        UiThreadUtil.runOnUiThread {
            releasePlayer(emitStoppedEvent = false)
            currentPlaybackId = playbackId
            currentUtteranceId = utteranceId

            val extension = when ((readableString(options, "contentType") ?: "").lowercase()) {
                "audio/wav", "audio/wave", "audio/x-wav" -> ".wav"
                "audio/ogg", "audio/opus", "audio/webm" -> ".ogg"
                else -> ".mp3"
            }

            val file = try {
                File.createTempFile("mingle_tts_", extension, reactContext.cacheDir).apply {
                    outputStream().use { output ->
                        output.write(decodedAudio)
                        output.flush()
                    }
                }
            } catch (error: Throwable) {
                val message = error.message ?: "unknown"
                releasePlayer(emitStoppedEvent = false)
                promise.reject("playback_error", "Failed to play audio: $message", error)
                return@runOnUiThread
            }
            currentAudioFile = file

            val player = MediaPlayer()
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            player.setOnCompletionListener {
                val payload = buildIdentityPayload(Arguments.createMap().apply {
                    putBoolean("success", true)
                })
                releasePlayer(emitStoppedEvent = false)
                emit("ttsPlaybackFinished", payload)
            }
            player.setOnErrorListener { _, what, extra ->
                val payload = buildIdentityPayload(Arguments.createMap().apply {
                    putString("message", "media_error:$what:$extra")
                })
                releasePlayer(emitStoppedEvent = false)
                emit("ttsError", payload)
                true
            }

            try {
                player.setDataSource(file.absolutePath)
                player.prepare()
                player.start()
                mediaPlayer = player
                val result = Arguments.createMap()
                result.putBoolean("ok", true)
                promise.resolve(result)
            } catch (error: Throwable) {
                val message = error.message ?: "unknown"
                releasePlayer(emitStoppedEvent = false)
                promise.reject("playback_error", "Failed to play audio: $message", error)
            }
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            releasePlayer(emitStoppedEvent = true)
            val result = Arguments.createMap()
            result.putBoolean("ok", true)
            promise.resolve(result)
        }
    }

    override fun invalidate() {
        UiThreadUtil.runOnUiThread {
            releasePlayer(emitStoppedEvent = false)
        }
        super.invalidate()
    }
}
