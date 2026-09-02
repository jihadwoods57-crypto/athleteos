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
  }
}
