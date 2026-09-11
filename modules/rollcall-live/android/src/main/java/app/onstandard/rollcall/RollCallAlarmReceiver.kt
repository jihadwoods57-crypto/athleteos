package app.onstandard.rollcall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * OnStandard — what happens the moment a coach's wake-up comes due.
 *
 * WHY A NOTIFICATION AND NOT `startActivity`. From Android 10 a background app cannot launch an
 * activity directly; the call is dropped and logged, which at 5:45 in the morning means silence. A
 * notification carrying a FULL-SCREEN intent is the documented way through: the system launches
 * the activity itself when the screen is locked, and shows a heads-up notification when it is not
 * — which is the right behaviour in both cases, since taking over the screen of somebody already
 * using their phone would be hostile.
 *
 * The channel is IMPORTANCE_HIGH with the ALARM usage and a category of CATEGORY_ALARM. That
 * combination is what lets it through Do Not Disturb's alarm exemption and makes it look like an
 * alarm to the system rather than a message.
 *
 * A repeating wake-up RE-ARMS itself here. Android has no durable weekly `setAlarmClock`, so the
 * only way a Tuesday alarm survives to the following Tuesday is to schedule the next one as this
 * one fires.
 */
class RollCallAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val instanceId = intent.getStringExtra(RollCallAlarmScheduler.EXTRA_INSTANCE_ID) ?: return
    val title = intent.getStringExtra(RollCallAlarmScheduler.EXTRA_TITLE) ?: "Wake up"
    val hour = intent.getIntExtra(RollCallAlarmScheduler.EXTRA_HOUR, -1)
    val minute = intent.getIntExtra(RollCallAlarmScheduler.EXTRA_MINUTE, -1)
    val weekdays = intent.getIntArrayExtra(RollCallAlarmScheduler.EXTRA_WEEKDAYS)?.toList().orEmpty()

    try {
      ring(context, instanceId, title)
    } catch (_: Throwable) {
      // A failure to present must never also cost the athlete next week's alarm, so re-arming
      // happens below regardless.
    }

    // Re-arm BEFORE anything can go wrong with the UI. A repeating wake-up that silently stops
    // after its first morning is worse than one that never worked, because nobody looks again.
    if (weekdays.isNotEmpty() && hour in 0..23 && minute in 0..59) {
      RollCallAlarmScheduler.schedule(context, instanceId, hour, minute, weekdays, title)
    }
  }

  private fun ring(context: Context, instanceId: String, title: String) {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(nm)

    val full = Intent(context, RollCallAlarmActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      putExtra(RollCallAlarmScheduler.EXTRA_INSTANCE_ID, instanceId)
      putExtra(RollCallAlarmScheduler.EXTRA_TITLE, title)
    }
    val fullPending = PendingIntent.getActivity(
      context, instanceId.hashCode(), full,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = Notification.Builder(context, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText("Tap to answer your coach's roll call.")
      .setSmallIcon(context.applicationInfo.icon)
      .setCategory(Notification.CATEGORY_ALARM)
      .setPriority(Notification.PRIORITY_MAX)
      .setAutoCancel(true)
      .setOngoing(true)
      // The whole reason this notification exists. On a locked device the system launches the
      // activity; on an unlocked one it shows as a heads-up and the athlete taps it.
      .setFullScreenIntent(fullPending, true)
      .setContentIntent(fullPending)
      .build()

    nm.notify(instanceId.hashCode(), notification)
  }

  private fun ensureChannel(nm: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Coach wake-up", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "The alarm your coach set. It rings through Do Not Disturb."
      // The activity owns the sound so it can keep ringing until somebody answers. A sound here
      // as well would play a second, overlapping tone.
      setSound(null, null)
      enableVibration(false)
      setBypassDnd(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    nm.createNotificationChannel(channel)
  }

  companion object {
    const val CHANNEL_ID = "rollcall-wakeup"
  }
}
