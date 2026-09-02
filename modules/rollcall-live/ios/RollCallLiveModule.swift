import ExpoModulesCore
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// OnStandard — rollcall-live, the iOS JS surface.
///
/// WHAT THIS MODULE IS FOR: getting two tokens off the device and up to the server, and nothing
/// else. It never starts a Live Activity locally. Starting locally would only work for an athlete
/// whose app was already running, which is the one athlete a 6 AM roll call is not for; every
/// activity is started by the server with a push-to-start.
///
///   PUSH-TO-START TOKEN (per device, iOS 17.2+). Authorises starting a NEW activity. It exists
///   whether or not any activity is running, which is exactly what lets a card appear on the lock
///   screen of a phone whose owner has not opened OnStandard in a week.
///
///   UPDATE TOKEN (per activity, iOS 16.1+). Authorises updating and ending ONE activity. Apple
///   warns it can rotate mid-activity, so this module keeps watching and re-reports.
///
/// Both are reported to JS as events; `src/lib/notify/rollcall.ts` posts them to
/// register_live_activity_token. Reporting is a plain event rather than a promise because the
/// streams are open-ended: a token can arrive minutes after launch, or twice.
public class RollCallLiveModule: Module {
  /// Started once; guarded so a re-mount does not stack observers.
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("RollCallLive")

    Events("onPushToStartToken", "onActivityToken")

    /// True only where a Live Activity can actually run: iOS 16.1+ for activities at all, and the
    /// athlete has not switched them off for OnStandard. JS uses this to decide whether the
    /// Profile screen should say lock-screen check-in is wired up.
    Function("isLiveActivitySupported") { () -> Bool in
      #if canImport(ActivityKit)
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      #endif
      return false
    }

    /// Begin watching both token streams. Idempotent, and safe to call on every launch.
    Function("startPushToStartObserver") { [weak self] () -> Void in
      self?.startObserving()
    }

    /// End the activity for one roll call from the device side. The server ends activities itself
    /// in the normal course; this exists for the case where the app knows the roll call is over
    /// before any push says so (the athlete answered in-app), so the card does not sit on the lock
    /// screen counting toward a deadline they have already met.
    AsyncFunction("endLiveActivity") { (instanceId: String) -> Void in
      #if canImport(ActivityKit)
      if #available(iOS 16.2, *) {
        for activity in Activity<RollCallAttributes>.activities
        where activity.attributes.instanceId == instanceId {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      #endif
    }

    /// Taps made on the Live Activity's own button while the app was not running. The intent can
    /// only write them into the App Group (it has no signed code and no retry policy of its own),
    /// so JS drains them on launch and foreground and feeds them through the SAME ack queue a
    /// notification tap uses. Returns `{ instanceId, at }` with `at` in epoch milliseconds.
    Function("drainPendingTaps") { () -> [[String: Any]] in
      RollCallPendingStore.drain()
    }

    /// The instance ids this device currently has a card on screen for. Device QA needs this:
    /// "no card appeared" and "a card appeared and then was dismissed" look identical afterwards.
    Function("activeInstanceIds") { () -> [String] in
      #if canImport(ActivityKit)
      if #available(iOS 16.1, *) {
        return Activity<RollCallAttributes>.activities.map { $0.attributes.instanceId }
      }
      #endif
      return []
    }
  }

  private func startObserving() {
    #if canImport(ActivityKit)
    guard !observing else { return }
    observing = true

    if #available(iOS 17.2, *) {
      // The push-to-start token. Apple: "You don't have to start a Live Activity from your app to
      // receive the push-to-start token."
      Task { [weak self] in
        for await data in Activity<RollCallAttributes>.pushToStartTokenUpdates {
          self?.sendEvent("onPushToStartToken", ["token": Self.hex(data)])
        }
      }
    }

    if #available(iOS 16.1, *) {
      // Update tokens for activities that already exist, plus every activity started later.
      // Two loops because `activityUpdates` only yields activities from the moment you start
      // listening: an activity the system started while the app was terminated is already in
      // `activities` by the time we get here, and would otherwise never report its token.
      Task { [weak self] in
        for activity in Activity<RollCallAttributes>.activities {
          self?.watchToken(of: activity)
        }
        for await activity in Activity<RollCallAttributes>.activityUpdates {
          self?.watchToken(of: activity)
        }
      }
    }
    #endif
  }

  #if canImport(ActivityKit)
  @available(iOS 16.1, *)
  private func watchToken(of activity: Activity<RollCallAttributes>) {
    let instanceId = activity.attributes.instanceId
    Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        self?.sendEvent("onActivityToken", [
          "token": Self.hex(data),
          "instanceId": instanceId,
        ])
      }
    }
  }

  /// Lowercase hex, no separators — the form APNs addresses a device by, and the form Apple's own
  /// sample converts to.
  private static func hex(_ data: Data) -> String {
    data.reduce("") { $0 + String(format: "%02x", $1) }
  }
  #endif
}
