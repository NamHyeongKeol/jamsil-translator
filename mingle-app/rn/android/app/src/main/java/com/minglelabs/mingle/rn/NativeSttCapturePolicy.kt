package com.minglelabs.mingle.rn

import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.media.AudioManager

data class NativeSttCaptureProfile(
  val label: String,
  val audioSource: Int,
  val audioMode: Int,
  val privacySensitive: Boolean,
  val foregroundServiceEnabled: Boolean,
  val aecEnabled: Boolean,
  val noiseSuppressorEnabled: Boolean,
)

object NativeSttCapturePolicy {
  // Keep the default policy isolated in one file so capture behavior can be
  // re-tuned later without touching the bridge or recorder implementation.
  private const val DEFAULT_PROFILE = "priority_translation"

  private val preferredSampleRates = intArrayOf(48_000, 44_100, 16_000)

  fun resolve(aecEnabled: Boolean): NativeSttCaptureProfile {
    return when (DEFAULT_PROFILE) {
      "standard_recognition" -> NativeSttCaptureProfile(
        label = "standard_recognition",
        audioSource = MediaRecorder.AudioSource.VOICE_RECOGNITION,
        audioMode = AudioManager.MODE_NORMAL,
        privacySensitive = false,
        foregroundServiceEnabled = false,
        aecEnabled = aecEnabled && AcousticEchoCanceler.isAvailable(),
        noiseSuppressorEnabled = aecEnabled && NoiseSuppressor.isAvailable(),
      )
      else -> NativeSttCaptureProfile(
        label = "priority_translation",
        audioSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        audioMode = if (aecEnabled) AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL,
        privacySensitive = true,
        foregroundServiceEnabled = true,
        aecEnabled = aecEnabled && AcousticEchoCanceler.isAvailable(),
        noiseSuppressorEnabled = aecEnabled && NoiseSuppressor.isAvailable(),
      )
    }
  }

  fun preferredSampleRates(
    currentSampleRate: Int?,
  ): IntArray {
    val ordered = linkedSetOf<Int>()
    if (currentSampleRate != null && currentSampleRate > 0) {
      ordered.add(currentSampleRate)
    }
    preferredSampleRates.forEach { ordered.add(it) }
    return ordered.toIntArray()
  }
}
