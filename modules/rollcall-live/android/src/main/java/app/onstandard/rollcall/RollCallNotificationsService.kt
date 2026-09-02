package app.onstandard.rollcall

import android.content.Context
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.interfaces.PresentationDelegate

/**
 * OnStandard — the receiver that swaps in [RollCallPresentationDelegate].
 *
 * HOW THE OVERRIDE WORKS, and why it is safe. expo-notifications declares its own
 * `NotificationsService` receiver with `android:priority="-1"`, and its dispatcher resolves the
 * handler with `queryBroadcastReceivers(...).firstOrNull()`. A receiver declared by the app at a
 * higher filter priority therefore sorts ahead of it and is the one that runs. We declare this at
 * `android:priority="1"` rather than relying on the default 0, so the ordering is a stated
 * intention rather than a tie.
 *
 * If that ordering ever stops holding, this class simply never runs and every notification is
 * presented exactly as expo-notifications presents it today. That is a cosmetic regression, not a
 * functional one: nothing about recording a check-in passes through here.
 */
class RollCallNotificationsService : NotificationsService() {
  override fun getPresentationDelegate(context: Context): PresentationDelegate =
    RollCallPresentationDelegate(context)
}
