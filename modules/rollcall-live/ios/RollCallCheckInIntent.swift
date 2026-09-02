import Foundation

#if canImport(AppIntents)
import AppIntents

/// OnStandard — the button inside the Live Activity.
///
/// TARGET MEMBERSHIP: BOTH the app and the widget extension. Two different requirements that are
/// easy to conflate:
///   - Apple requires it in the APP target, because that is the process the system runs
///     `perform()` in: "the system runs the app intent in the app's process. Make sure to add your
///     custom app intent to your app target."
///   - The EXTENSION needs the type at COMPILE time, because RollCallWidget.swift constructs it to
///     hand to `Button(intent:)`. Leave it out and the extension does not build ("Cannot find
///     'RollCallCheckInIntent' in scope").
/// Compiling it into both does not change where it runs: the `LiveActivityIntent` conformance is
/// what routes execution to the app process, not which target holds the source.
///
/// WHAT IT IS AND IS NOT. It is a convenience for a phone already in the athlete's hand. It is NOT
/// the primary way a roll call gets answered: Apple makes buttons in a Live Activity inactive on a
/// LOCKED device until the person authenticates, so the button that has to work at 6 AM on a phone
/// lying on a nightstand is the notification's action button, which has recorded taps since 0144
/// and is untouched by any of this.
///
/// HOW IT RECORDS. It writes the tap into the App Group and asks the JS layer to drain it, rather
/// than calling the ack endpoint from Swift. Two reasons, both about not having two sources of
/// truth: the signed code that authorises an ack is minted per push and held by the JS layer's
/// queue, and that queue already owns the retry, the offline case and the "which outcomes are
/// worth replaying" policy (src/core/rollcall.ts). Duplicating any of that in Swift would be a
/// second implementation of the one rule the product cannot get wrong.
@available(iOS 17.0, *)
public struct RollCallCheckInIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Check in"
  public static var description = IntentDescription("Answer your coach's roll call.")

  /// Never true here. The whole point is that answering does not open OnStandard.
  public static var openAppWhenRun: Bool = false

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

/// The hand-off between the intent (which runs in a short, unspecified slice of background time)
/// and the JS layer (which owns the signed code and the retry queue).
///
/// App Group storage rather than `UserDefaults.standard`: the widget extension and the app are
/// separate processes with separate containers, and the suite is the only thing both can see.
public enum RollCallPendingStore {
  /// Must match the App Group created in the Apple Developer portal and declared on BOTH targets.
  public static let suiteName = "group.com.onstandard.app"
  static let key = "rollcall.pendingTaps"

  /// Append one tap. Deliberately additive and tiny: this runs inside `perform()`, which Apple
  /// gives no documented time budget, so it does no I/O beyond one defaults write.
  public static func record(instanceId: String, at date: Date) {
    guard !instanceId.isEmpty, let defaults = UserDefaults(suiteName: suiteName) else { return }
    var pending = defaults.array(forKey: key) as? [[String: Any]] ?? []
    // One entry per instance: pressing twice is one answer, and the first tap is the one that
    // counts, exactly as the server's first-tap-wins rule already says.
    guard !pending.contains(where: { $0["instanceId"] as? String == instanceId }) else { return }
    pending.append(["instanceId": instanceId, "at": date.timeIntervalSince1970 * 1000])
    defaults.set(pending, forKey: key)
  }

  /// Read and clear. Called by the module when the app next runs.
  public static func drain() -> [[String: Any]] {
    guard let defaults = UserDefaults(suiteName: suiteName) else { return [] }
    let pending = defaults.array(forKey: key) as? [[String: Any]] ?? []
    if !pending.isEmpty { defaults.removeObject(forKey: key) }
    return pending
  }
}
