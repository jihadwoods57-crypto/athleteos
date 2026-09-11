import Foundation

#if canImport(AlarmKit)
import AlarmKit
#endif
#if canImport(SwiftUI)
import SwiftUI
#endif
#if canImport(AppIntents)
import AppIntents
#endif
#if canImport(ActivityKit)
import ActivityKit
#endif

/// OnStandard — the coach-assigned wake-up, as a real iOS alarm.
///
/// WHY ALARMKIT AND NOT A NOTIFICATION. A notification is silenced by a Focus, by silent mode, and
/// by the volume slider. A coach's 5:45 wake-up that a Sleep Focus can mute is not a wake-up. An
/// AlarmKit alarm "overrides both a device's focus and silent mode", which is the entire reason
/// this file exists. It is iOS 26 and up; every call below degrades to nothing anywhere else, so a
/// phone on iOS 18 keeps exactly the roll-call notification it has today.
///
/// WHAT APPLE OWNS, AND WHAT WE DO ABOUT IT. The founder asked for "Attack the day" as the main
/// button with snooze second. Apple does not allow that any more: the only initialiser that took a
/// custom primary button is deprecated with the note "stopButton is deprecated and will no longer
/// be used" — passing one is ignored, not merely discouraged. The system owns the primary button
/// and labels it itself.
///
/// So the layout is the closest honest thing the API permits, and it is arguably better:
///
///   - the SECONDARY button is fully ours, and it reads "Attack the day" in the app's blue with a
///     sunrise glyph;
///   - `stopIntent` attaches OUR intent to Apple's own primary button, so an athlete who hits the
///     obvious system button is recorded as up just the same.
///
/// That last part is the load-bearing one. Without it the big system button would dismiss the
/// alarm and record nothing, and the athlete would be marked missed for using the button the
/// system made most prominent.
///
/// NO COUNTDOWN PRESENTATION, DELIBERATELY. Apple: "AlarmKit expects a widget extension if an app
/// supports a countdown presentation. Otherwise, the system may unexpectedly dismiss alarms and
/// fail to alert." A wake-up has no countdown - it is a fixed time - so this schedules an
/// alert-only presentation and never risks that failure mode.
///
/// WHY iOS 26.1 AND NOT 26.0. AlarmKit itself arrived in 26.0, but the only Alert initialiser
/// that does NOT take the dead `stopButton` argument is 26.1+ (build 35 failed on exactly that:
/// "'init(title:secondaryButton:secondaryButtonBehavior:)' is only available in iOS 26.1 or
/// newer"). On 26.0 the sole way to construct an alert is the initialiser Apple has already said
/// will be ignored. Rather than carry a second code path built on a deprecated call for one
/// point release, the whole feature asks for 26.1 and a 26.0 phone keeps the roll-call
/// notification it has today.
public enum RollCallAlarm {
  /// Mirrors the JS `WAKEUP_TYPE`. Only ever one alarm per roll-call instance.
  public static let secondaryButtonLabel = "Attack the day"

  /// True when this build and this device can actually schedule one.
  public static var isSupported: Bool {
    #if canImport(AlarmKit)
    if #available(iOS 26.1, *) { return true }
    #endif
    return false
  }
}

#if canImport(AlarmKit)

/// The payload AlarmKit hands back to the widget extension with the alarm. Kept to the two strings
/// a lock-screen or StandBy presentation would want; nothing here is a secret, because the same
/// value is readable by the extension process.
@available(iOS 26.1, *)
public struct WakeUpMetadata: AlarmMetadata {
  /// The commitment instance this wake-up answers. The ONE id that ties the alarm, the intent, the
  /// pending-tap store and the server's roll call together.
  public let instanceId: String
  /// The coach's own words for the morning, e.g. "Varsity lift".
  public let label: String

  public init(instanceId: String, label: String) {
    self.instanceId = instanceId
    self.label = label
  }
}

/// Schedules, cancels and lists the wake-up alarms this device owns.
///
/// Every function is `@available(iOS 26.1, *)`; the module's JS surface guards each call so a
/// caller never has to.
@available(iOS 26.1, *)
public enum RollCallAlarmScheduler {
  /// The app's blue. AlarmKit takes exactly ONE colour for the whole alert, so the brand's
  /// blue-to-teal sweep cannot go here - a gradient is not expressible. Blue is the anchor end of
  /// that sweep and the one the rest of the app leads with.
  static let tint = Color(red: 0.20, green: 0.51, blue: 0.98)

  // MARK: authorization

  /// The current state, without prompting. `notDetermined` until the athlete has been asked.
  public static func authorizationState() -> String {
    switch AlarmManager.shared.authorizationState {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  /// Ask once. Apple also asks implicitly on the first `schedule`, but doing it explicitly lets the
  /// app put the request next to the coach's wake-up card, where it makes sense, rather than
  /// beside whatever screen happened to trigger the first schedule.
  ///
  /// Without a non-empty `NSAlarmKitUsageDescription` in Info.plist, apps simply cannot schedule
  /// alarms - the plugin adds it.
  public static func requestAuthorization() async -> String {
    do {
      let state = try await AlarmManager.shared.requestAuthorization()
      switch state {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unknown"
      }
    } catch {
      return "error"
    }
  }

  // MARK: scheduling

  /// Schedule (or replace) the wake-up for one roll-call instance.
  ///
  /// - Parameters:
  ///   - instanceId: the commitment instance. Also the alarm's identity - see `alarmID`.
  ///   - hour/minute: the coach's wake-up time, on the athlete's own clock.
  ///   - weekdays: 1 = Sunday ... 7 = Saturday, matching JS `Date.getDay() + 1` and
  ///     `Locale.Weekday`. EMPTY means a one-off alarm, which is what a single dated roll call is.
  ///   - title: what the alert says. The coach's label, or "Wake up".
  /// - Returns: the alarm's UUID string.
  public static func schedule(
    instanceId: String,
    hour: Int,
    minute: Int,
    weekdays: [Int],
    title: String
  ) async throws -> String {
    let id = alarmID(for: instanceId)

    // Replacing rather than stacking: a coach who moves the wake-up from 5:45 to 6:00 must not
    // leave the athlete with two alarms. `schedule` with the same id replaces, but cancelling
    // first also clears an alarm left over from a schedule the server has since deleted.
    try? AlarmManager.shared.cancel(id: id)

    let button = AlarmButton(
      text: LocalizedStringResource(stringLiteral: RollCallAlarm.secondaryButtonLabel),
      textColor: tint,
      systemImageName: "sunrise.fill"
    )

    // `.custom` routes the button to OUR intent. `.countdown` would make it a Repeat/snooze, which
    // the roll call has no concept of: the server only knows on time, late, and never answered, so
    // a snooze would be a button whose effect nothing downstream could record.
    let alert = AlarmPresentation.Alert(
      title: LocalizedStringResource(stringLiteral: title),
      secondaryButton: button,
      secondaryButtonBehavior: .custom
    )

    let attributes = AlarmAttributes(
      presentation: AlarmPresentation(alert: alert),
      metadata: WakeUpMetadata(instanceId: instanceId, label: title),
      tintColor: tint
    )

    let schedule: Alarm.Schedule = .relative(
      .init(
        time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
        repeats: weekdays.isEmpty ? .never : .weekly(weekdays.compactMap(Self.weekday))
      )
    )

    let configuration = AlarmManager.AlarmConfiguration(
      schedule: schedule,
      attributes: attributes,
      // Apple's own primary button, carrying our intent. This is what stops the most obvious
      // button on the screen from dismissing the alarm and recording nothing.
      stopIntent: RollCallCheckInIntent(instanceId: instanceId),
      secondaryIntent: RollCallAttackDayIntent(instanceId: instanceId),
      // The system alarm tone. The founder was explicit that this is a normal alarm and not a
      // voice, so nothing custom is named here.
      sound: .default
    )

    _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
    return id.uuidString
  }

  /// Cancel the wake-up for one instance. Safe to call for an instance that never had one.
  public static func cancel(instanceId: String) {
    try? AlarmManager.shared.cancel(id: alarmID(for: instanceId))
  }

  /// Every alarm this app currently owns, for device QA. "No alarm fired" and "no alarm was ever
  /// scheduled" are indistinguishable the morning after without this.
  public static func scheduled() -> [[String: Any]] {
    guard let alarms = try? AlarmManager.shared.alarms else { return [] }
    return alarms.map { alarm in
      ["id": alarm.id.uuidString, "state": String(describing: alarm.state)]
    }
  }

  // MARK: identity

  /// The alarm's id, derived from the instance id so cancelling needs no stored mapping.
  ///
  /// A commitment instance id IS a UUID in production, so the common path is exact. The hash
  /// fallback exists for any other id shape (a fixture, a future owner kind) and is stable, which
  /// is the only property that matters: the same instance must always resolve to the same alarm,
  /// or cancel would miss and the athlete would get an alarm nobody can turn off.
  static func alarmID(for instanceId: String) -> UUID {
    if let exact = UUID(uuidString: instanceId) { return exact }
    var bytes = Array(Data(instanceId.utf8))
    // Pad or truncate to the 16 bytes a UUID needs. Not a cryptographic hash and does not need to
    // be: collisions between two instance ids on ONE device are the only risk, and a device holds
    // a handful of wake-ups at a time.
    while bytes.count < 16 { bytes.append(UInt8(bytes.count &* 31 &+ 7)) }
    let uuid = uuid_t(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                      bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])
    return UUID(uuid: uuid)
  }

  /// 1 = Sunday ... 7 = Saturday. Matches JS `getDay() + 1`, so the two halves agree without a
  /// second convention to remember.
  static func weekday(_ n: Int) -> Locale.Weekday? {
    switch n {
    case 1: return .sunday
    case 2: return .monday
    case 3: return .tuesday
    case 4: return .wednesday
    case 5: return .thursday
    case 6: return .friday
    case 7: return .saturday
    default: return nil
    }
  }
}

#endif

#if canImport(AppIntents)
/// The "Attack the day" button.
///
/// It does exactly what the Live Activity's check-in button does - writes the tap into the App
/// Group for the JS queue to drain - and then opens the app, because the athlete just told it they
/// are getting up and the next thing they owe is breakfast.
///
/// TARGET MEMBERSHIP: the app target, same as RollCallCheckInIntent. Apple runs a
/// `LiveActivityIntent` in the app's process.
@available(iOS 17.0, *)
public struct RollCallAttackDayIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Attack the day"
  public static var description = IntentDescription("Answer your coach's wake-up and start the day.")

  /// Unlike the Live Activity's check-in button, this one DOES open OnStandard. It is the morning's
  /// deliberate button: the athlete chose it over the system's dismiss.
  public static var openAppWhenRun: Bool = true

  @Parameter(title: "Instance")
  public var instanceId: String

  public init() { self.instanceId = "" }

  public init(instanceId: String) { self.instanceId = instanceId }

  public func perform() async throws -> some IntentResult {
    RollCallPendingStore.record(instanceId: instanceId, at: Date())
    return .result()
  }
}
#endif
