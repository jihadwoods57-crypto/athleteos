package app.onstandard.rollcall

import android.app.Notification
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate
import org.json.JSONObject
import expo.modules.notifications.notifications.model.Notification as ExpoNotification

/**
 * OnStandard — the Android half of the alarm-grade Wake-Up Roll Call.
 *
 * WHAT THIS IS FOR. expo-notifications draws every pushed notification the same way: a title, a
 * body under BigTextStyle, and whatever action buttons the category declares. There is no push
 * field for a countdown, for the alarm category, or for Android 16's Live Update promotion, and no
 * JS API for any of them either. So a 6 AM roll call looked exactly like a marketing message.
 *
 * WHAT IT DOES NOT DO: draw its own layout. Android 12 flattens `setCustomContentView` into the
 * system template anyway, and Android 16 disqualifies any notification carrying a custom view from
 * being promoted to a Live Update. A custom layout would therefore cost us the one thing worth
 * having. We keep the system's own presentation and add the three things it can do that
 * expo-notifications never asks for:
 *
 *   1. A COUNTDOWN the OS ticks (`EXTRA_SHOW_CHRONOMETER` + `EXTRA_CHRONOMETER_COUNT_DOWN` to the
 *      deadline). No push is needed to keep it honest, which is the whole point.
 *   2. ALARM CATEGORY and the state colour, so Do Not Disturb's "alarms only" mode can let it
 *      through when the athlete has chosen that, and the card carries the state's hue.
 *   3. LIVE UPDATE PROMOTION on Android 16+, which pins the roll call open on the lock screen and
 *      puts its countdown in the status bar as a chip.
 *
 * HOW IT DOES IT: by MUTATING the notification the superclass already built, never by rebuilding
 * one. Expo marshals its own NotificationRequest into the notification's extras and relies on
 * reading it back later; a rebuilt notification would lose that, and with it the dismissal and
 * response plumbing. Every property below is a public field or a documented extra, so mutation is
 * the supported path and the cheap one.
 *
 * FAIL-SAFE BY CONSTRUCTION. If this class never runs — the manifest override does not win, the
 * push carries no roll-call keys, an OEM ignores a flag — the athlete gets exactly the notification
 * they got before it existed. Nothing here is on the path that RECORDS a check-in; that is the
 * action button, and it is untouched.
 */
open class RollCallPresentationDelegate(
  context: Context,
  notificationManager: NotificationManagerCompat = NotificationManagerCompat.from(context)
) : ExpoPresentationDelegate(context, notificationManager) {

  companion object {
    /** Set by the server on a Wake-Up Roll Call push. Absent on every other notification, which is
     *  how this delegate knows to keep its hands off. */
    const val KEY_PHASE = "rc_phase"

    /** Epoch MILLISECONDS. The instant the countdown runs to (grace end) and then past. */
    const val KEY_DEADLINE = "rc_deadline"

    /** Epoch milliseconds of close: after this the roll call cannot be answered at all. */
    const val KEY_CLOSES = "rc_closes"

    /** #RRGGBB for the state. */
    const val KEY_COLOR = "rc_color"

    const val PHASE_INITIAL = "initial"
    const val PHASE_REMINDER = "reminder"
    const val PHASE_LATE = "late"

    /**
     * Android 16's request-to-promote extra. Referenced by name rather than through
     * NotificationCompat so this module compiles against the androidx version already on the
     * classpath: the constant arrived in a recent core release, and a hard reference would turn a
     * dependency skew into a build failure for a feature that is meant to degrade quietly.
     */
    const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

    /** API 36. Not referenced as Build.VERSION_CODES.BAKLAVA for the same reason. */
    const val ANDROID_16 = 36
  }

  override suspend fun createNotification(
    notification: ExpoNotification,
    notificationBehavior: NotificationBehaviorRecord?
  ): Notification {
    val built = super.createNotification(notification, notificationBehavior)
    return try {
      val data = notification.notificationRequest.content.body ?: return built
      decorate(built, data)
    } catch (_: Throwable) {
      // A roll call that looks ordinary beats a roll call that never arrives.
      built
    }
  }

  /** Apply the roll-call treatment, or return the notification untouched when this is not one. */
  private fun decorate(n: Notification, data: JSONObject): Notification {
    val phase = data.optString(KEY_PHASE, "")
    if (phase.isEmpty()) return n

    val deadline = data.optLong(KEY_DEADLINE, 0L)
    val closes = data.optLong(KEY_CLOSES, 0L)

    // ---- the countdown ------------------------------------------------------------------
    // `when` is the instant the chronometer measures against, so it is the DEADLINE, not now.
    // Counting down is right up to the deadline; past it we count UP, which is exactly the
    // "3 min late" the card wants, and the same two extras express both.
    if (deadline > 0L) {
      val now = System.currentTimeMillis()
      val countDown = now < deadline
      n.`when` = deadline
      n.extras.putBoolean(Notification.EXTRA_SHOW_CHRONOMETER, true)
      n.extras.putBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN, countDown)
      n.extras.putBoolean(Notification.EXTRA_SHOW_WHEN, true)
    }

    // ---- what kind of thing this is -----------------------------------------------------
    // CATEGORY_ALARM is advisory: it does not bypass Do Not Disturb, it makes the roll call
    // eligible for the athlete's own "alarms only" allowance. That is the honest claim, and the
    // one the app already makes everywhere else about not overriding a phone's own settings.
    n.category = Notification.CATEGORY_ALARM

    data.optString(KEY_COLOR, "").takeIf { it.isNotEmpty() }?.let { hex ->
      runCatching { n.color = android.graphics.Color.parseColor(hex) }
    }

    // ---- Android 16: pin it to the lock screen -------------------------------------------
    // A Live Update stays expanded and uncollapsible on the lock screen and shows its countdown as
    // a status-bar chip. Android grants this only to a notification that is ongoing, has a content
    // title, carries no custom view and is not colorized. The superclass already satisfies the last
    // three; ongoing is ours to set, and we take it back off once the roll call is answerable no
    // longer, so a closed roll call can be swiped away like anything else.
    if (Build.VERSION.SDK_INT >= ANDROID_16) {
      val stillOpen = closes <= 0L || System.currentTimeMillis() < closes
      if (stillOpen) {
        n.extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
        n.flags = n.flags or Notification.FLAG_ONGOING_EVENT
      }
    }
    return n
  }
}
