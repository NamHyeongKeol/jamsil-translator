package com.minglelabs.mingle.rn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class NativeSTTForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopForegroundService()
      else -> startForegroundService()
    }
    return START_NOT_STICKY
  }

  private fun startForegroundService() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Mingle microphone active")
      .setContentText("Speech translation capture is running")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundService() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) {
      return
    }
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Mingle microphone",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps speech translation capture active in the background"
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "mingle_stt_capture"
    private const val NOTIFICATION_ID = 44_001
    private const val ACTION_START = "com.minglelabs.mingle.rn.stt.START"
    private const val ACTION_STOP = "com.minglelabs.mingle.rn.stt.STOP"

    fun start(context: Context) {
      val intent = Intent(context, NativeSTTForegroundService::class.java).apply {
        action = ACTION_START
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, NativeSTTForegroundService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }
}
