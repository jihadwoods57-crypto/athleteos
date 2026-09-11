package app.onstandard.rollcall

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * OnStandard — the coach-assigned wake-up, as a real Android alarm.
 *
 * `setAlarmClock` and not `setExactAndAllowWhileIdle`, and the difference is the whole point.
 * `setAlarmClock` is the one scheduling call Android treats as a USER-FACING ALARM: it is exempt
 * from Doze and from app standby, it shows in the status bar as the next alarm, and it is the API
 * the platform's own Clock app uses. Everything else is subject to batching that can move a 5:45
 * wake-up by fifteen minutes, which for this product is the same as not firing.
 *
 * The chain is: setAlarmClock -> [RollCallAlarmReceiver] -> full-screen intent -> [RollCallAlarmActivity].
 * Android does not let a background app start an activity directly any more, so the receiver posts
 * a notification carrying a FULL-SCREEN intent; the system launches the activity itself when the
 * device is locked, and shows a heads-up notification when it is not. That is the documented path
 * and the only one that works from API 29 up.
 */
object RollCallAlarmScheduler {
  const val EXTRA_INSTANCE_ID = "app.onstandard.rollcall.INSTANCE_ID"
  const val EXTRA_TITLE = "app.onstandard.rollcall.TITLE"
  const val EXTRA_WEEKDAYS = "app.onstandard.rollcall.WEEKDAYS"
  const val EXTRA_HOUR = "app.onstandard.rollcall.HOUR"
  const val EXTRA_MINUTE = "app.onstandard.rollcall.MINUTE"

  /** Where the scheduled set lives, so [scheduled] can answer and a reboot can re-arm. */
  private const val PREFS = "rollcall.alarms"

  /**
   * Whether this app may schedule an exact alarm at all.
   *
   * From Android 12 the permission is revocable, and from Android 14 `SCHEDULE_EXACT_ALARM` is no
   * longer granted on install for most apps. `USE_EXACT_ALARM` (declared in the manifest) IS
   * granted on install, but Google only permits it for apps whose core function is an alarm or
   * calendar — which a coach-assigned wake-up is. This still checks at runtime, because the answer
   * decides whether the app should show the athlete a "turn this on" row instead of a silent
   * failure at 5:45 the next morning.
   */
  fun canScheduleExact(context: Context): Boolean = try {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      true
    } else {
      alarmManager(context).canScheduleExactAlarms()
    }
  } catch (_: Throwable) {
    false
  }

  /**
   * Schedule (or replace) the wake-up for one roll-call instance.
   *
   * @param weekdays 1 = Sunday .. 7 = Saturday, matching [Calendar.DAY_OF_WEEK] and the iOS half.
   *   EMPTY means a one-off: the next occurrence of hour:minute.
   * @return the epoch-millisecond instant it will fire, or 0 if it could not be scheduled.
   */
  fun schedule(
    context: Context,
    instanceId: String,
    hour: Int,
    minute: Int,
    weekdays: List<Int>,
    title: String,
  ): Long {
    if (instanceId.isEmpty()) return 0L
    if (!canScheduleExact(context)) return 0L
    val at = nextOccurrence(hour, minute, weekdays)

    val fire = Intent(context, RollCallAlarmReceiver::class.java).apply {
      // A unique action per instance. Two PendingIntents are "the same" to Android when their
      // intents match by everything EXCEPT extras, so without this a second wake-up would silently
      // replace the first one's alarm rather than sitting alongside it.
      action = "app.onstandard.rollcall.FIRE.$instanceId"
      putExtra(EXTRA_INSTANCE_ID, instanceId)
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_HOUR, hour)
      putExtra(EXTRA_MINUTE, minute)
      putExtra(EXTRA_WEEKDAYS, weekdays.toIntArray())
    }
    val operation = PendingIntent.getBroadcast(
      context, instanceId.hashCode(), fire,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    // The show intent is what the user gets by tapping the alarm in the status bar or on the lock
    // screen BEFORE it fires. Pointing it at the alarm screen would be wrong - nothing is ringing
    // yet - so it opens the app.
    val show = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val showPending = if (show == null) null else PendingIntent.getActivity(
      context, instanceId.hashCode(), show,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return try {
      alarmManager(context).setAlarmClock(AlarmManager.AlarmClockInfo(at, showPending), operation)
      remember(context, instanceId, at)
      at
    } catch (_: SecurityException) {
      // The permission was revoked between the check above and here. Answering 0 lets JS tell the
      // athlete, which is the only useful thing to do with it.
      0L
    } catch (_: Throwable) {
      0L
    }
  }

  /**
   * Re-arm one wake-up a fixed number of minutes from now: the snooze.
   *
   * Deliberately a ONE-OFF even when the wake-up repeats weekly. The weekly alarm has already
   * re-armed itself in [RollCallAlarmReceiver]; this is an extra ring today, and giving it the
   * recurrence too would quietly add a second weekly alarm nine minutes after the first.
   */
  fun scheduleIn(context: Context, instanceId: String, minutes: Int, title: String): Long {
    val c = Calendar.getInstance().apply { add(Calendar.MINUTE, minutes) }
    return schedule(
      context, instanceId,
      c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE),
      emptyList(), title,
    )
  }

  /** Cancel the wake-up for one instance. Safe for one that was never scheduled. */
  fun cancel(context: Context, instanceId: String) {
    if (instanceId.isEmpty()) return
    val fire = Intent(context, RollCallAlarmReceiver::class.java).apply {
      action = "app.onstandard.rollcall.FIRE.$instanceId"
    }
    val operation = PendingIntent.getBroadcast(
      context, instanceId.hashCode(), fire,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    try {
      alarmManager(context).cancel(operation)
      operation.cancel()
    } catch (_: Throwable) {
      // best effort
    }
    forget(context, instanceId)
  }

  /** Everything this device has armed, as `instanceId -> epoch millis`. Device QA only. */
  fun scheduled(context: Context): List<Map<String, Any>> = try {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.mapNotNull { (k, v) ->
      val at = (v as? Long) ?: return@mapNotNull null
      mapOf<String, Any>("instanceId" to k, "at" to at)
    }
  } catch (_: Throwable) {
    emptyList()
  }

  /**
   * The next instant hour:minute happens.
   *
   * With no weekdays it is today if that time has not passed, otherwise tomorrow. With weekdays it
   * is the soonest of those days at that time, searching a full week forward so "Monday" scheduled
   * on a Monday afternoon lands on the NEXT Monday rather than one already gone.
   */
  fun nextOccurrence(hour: Int, minute: Int, weekdays: List<Int>, now: Long = System.currentTimeMillis()): Long {
    val c = Calendar.getInstance().apply {
      timeInMillis = now
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (weekdays.isEmpty()) {
      if (c.timeInMillis <= now) c.add(Calendar.DAY_OF_YEAR, 1)
      return c.timeInMillis
    }
    val wanted = weekdays.filter { it in 1..7 }.toSet()
    if (wanted.isEmpty()) {
      if (c.timeInMillis <= now) c.add(Calendar.DAY_OF_YEAR, 1)
      return c.timeInMillis
    }
    repeat(8) {
      if (c.timeInMillis > now && c.get(Calendar.DAY_OF_WEEK) in wanted) return c.timeInMillis
      c.add(Calendar.DAY_OF_YEAR, 1)
    }
    return c.timeInMillis
  }

  private fun alarmManager(context: Context) =
    context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun remember(context: Context, instanceId: String, at: Long) {
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit().putLong(instanceId, at).apply()
    } catch (_: Throwable) {
      // best effort
    }
  }

  private fun forget(context: Context, instanceId: String) {
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit().remove(instanceId).apply()
    } catch (_: Throwable) {
      // best effort
    }
  }
}
