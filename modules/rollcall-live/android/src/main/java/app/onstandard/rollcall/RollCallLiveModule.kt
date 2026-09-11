package app.onstandard.rollcall

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * OnStandard — rollcall-live, the Android JS surface.
 *
 * Deliberately tiny. Android needs no per-activity token bookkeeping the way iOS does: the roll
 * call's presentation is decided entirely inside [RollCallPresentationDelegate] from the fields the
 * server already puts on the push. What JS gets is the two questions device QA has to be able to
 * answer on a real handset, because both fail SILENTLY and neither is visible from a screenshot:
 *
 *   1. Did our presentation override actually win over expo-notifications'?
 *   2. Will this phone honour a Live Update promotion at all?
 *
 * Without these, "the countdown did not appear" has half a dozen indistinguishable causes.
 */
class RollCallLiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RollCallLive")

    /**
     * True when the receiver Android would dispatch a notification event to is ours. Mirrors
     * expo-notifications' own resolution (`queryBroadcastReceivers(...).firstOrNull()`), so it
     * answers the real question rather than a proxy for it.
     */
    Function("isPresentationOverrideActive") {
      val context = appContext.reactContext ?: return@Function false
      try {
        val intent = Intent("expo.modules.notifications.NOTIFICATION_EVENT").setPackage(context.packageName)
        val resolved = context.packageManager.queryBroadcastReceivers(intent, 0)
        val winner = resolved.firstOrNull()?.activityInfo?.name
        winner == RollCallNotificationsService::class.java.name
      } catch (_: Throwable) {
        false
      }
    }

    /** Whether this device can show Live Updates at all (Android 16+, permission granted, and the
     *  athlete has not turned them off for OnStandard). False everywhere below API 36. */
    Function("canPostPromotedNotifications") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < RollCallPresentationDelegate.ANDROID_16) return@Function false
      try {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Reflection rather than a direct call: the method arrived in API 36 and a hard reference
        // would not compile against an older compileSdk. A missing method reads as "no", which is
        // the correct answer on any device that does not have it.
        val m = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
        m.invoke(nm) as? Boolean ?: false
      } catch (_: Throwable) {
        false
      }
    }

    /** Live Activities are iOS-only; the JS layer branches on this rather than on Platform.OS so
     *  the two halves of the module answer the same question in the same way. */
    Function("isLiveActivitySupported") { false }

    Function("startPushToStartObserver") { /* iOS only */ }

    AsyncFunction("endLiveActivity") { _: String -> /* iOS only */ }

    // ---------------------------------------------------------------- the wake-up alarm
    // setAlarmClock is the one scheduling call Android treats as a user-facing alarm: exempt from
    // Doze and app standby, visible in the status bar, and the API the platform Clock app uses.
    // See RollCallAlarmScheduler for why nothing weaker is good enough at 5:45.

    /** Whether this phone will let us arm an exact alarm at all (Android 12+ can revoke it). */
    Function("isAlarmSupported") {
      val context = appContext.reactContext ?: return@Function false
      RollCallAlarmScheduler.canScheduleExact(context)
    }

    /** Android grants this by manifest (USE_EXACT_ALARM) rather than by prompt, so the state is
     *  simply whether the system currently allows it. Same vocabulary as the iOS half. */
    Function("alarmAuthorizationState") {
      val context = appContext.reactContext ?: return@Function "unsupported"
      if (RollCallAlarmScheduler.canScheduleExact(context)) "authorized" else "denied"
    }

    AsyncFunction("requestAlarmAuthorization") {
      val context = appContext.reactContext ?: return@AsyncFunction "unsupported"
      // Nothing to prompt for: the permission is granted at install or it is not. Reporting the
      // live state keeps the promise honest rather than claiming a request happened.
      if (RollCallAlarmScheduler.canScheduleExact(context)) "authorized" else "denied"
    }

    /** Schedule (or replace) one wake-up. `weekdays` is 1 = Sunday .. 7 = Saturday; EMPTY is a
     *  one-off. Resolves to the alarm id, or "" when it could not be armed. */
    AsyncFunction("scheduleWakeAlarm") { instanceId: String, hour: Int, minute: Int, weekdays: List<Int>, title: String, buttonLabel: String ->
      val context = appContext.reactContext ?: return@AsyncFunction ""
      val at = RollCallAlarmScheduler.schedule(context, instanceId, hour, minute, weekdays, title, buttonLabel)
      if (at > 0L) instanceId else ""
    }

    Function("cancelWakeAlarm") { instanceId: String ->
      appContext.reactContext?.let { RollCallAlarmScheduler.cancel(it, instanceId) }
    }

    /** Everything armed right now. Device QA only: the morning after, "no alarm fired" and "no
     *  alarm was ever scheduled" are otherwise indistinguishable. */
    Function("scheduledWakeAlarms") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
      RollCallAlarmScheduler.scheduled(context)
    }

    /** Taps recorded by the alarm screen while JS was not running. Mirrors the iOS payload. */
    Function("drainPendingTaps") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
      RollCallPendingTaps.drain(context)
    }

  }
}
