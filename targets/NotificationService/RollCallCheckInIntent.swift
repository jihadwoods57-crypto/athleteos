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
/// HOW IT RECORDS (2026-09-23). Two things, in this order:
///   1. It writes the tap into the App Group for the JS layer to drain. That is the FALLBACK, and
///      it goes first so nothing that happens to the network can lose the tap.
///   2. When the card (or the alarm) carries a WINDOW code, it posts `{ code, tapped_at }` to
///      roll-call-ack itself. That is what makes the check-in land with OnStandard closed, which
///      is the whole point of a button on the lock screen. The window code is minted per roll
///      call by the server (Live Activity start attributes; the mint route for alarms armed days
///      ahead) and is only good for this athlete and this morning.
/// The server's first tap stands, so a tap posted here AND later drained by the app is one answer.
/// The retry, the offline case and the replay policy stay in the JS queue (src/lib/notify/rollcall.ts):
/// this post is one attempt, and a failure simply leaves the drain to do what it always did.
@available(iOS 17.0, *)
public struct RollCallCheckInIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Check in"
  public static var description = IntentDescription("Answer your coach's roll call.")

  /// Never true here. The whole point is that answering does not open OnStandard.
  public static var openAppWhenRun: Bool = false

  @Parameter(title: "Instance")
  public var instanceId: String

  /// The window code, or nil on a card started by a server that predates it.
  @Parameter(title: "Code")
  public var ackCode: String?

  /// Where to post it: `<SUPABASE_URL>/functions/v1/roll-call-ack`. Nil alongside `ackCode`.
  @Parameter(title: "Endpoint")
  public var ackUrl: String?

  public init() {
    self.instanceId = ""
    self.ackCode = nil
    self.ackUrl = nil
  }

  public init(instanceId: String, ackCode: String? = nil, ackUrl: String? = nil) {
    self.instanceId = instanceId
    self.ackCode = ackCode
    self.ackUrl = ackUrl
  }

  public func perform() async throws -> some IntentResult {
    let at = Date()
    // Fallback first, drained by the app: nothing the network does below can lose this tap.
    RollCallPendingStore.record(instanceId: instanceId, at: at)
    await RollCallAckPoster.post(code: ackCode, url: ackUrl, at: at)
    return .result()
  }
}
#endif

/// Posts one tap to roll-call-ack with the window code, from whichever intent was pressed (the
/// card's button, the alarm's Stop, the alarm's own button). Foundation only, so it compiles in
/// both targets beside the store below.
public enum RollCallAckPoster {
  /// Short on purpose: an intent gets an unspecified slice of background time, and a post that
  /// has not answered in 8 seconds is left to the app's drain rather than holding the intent open.
  public static let timeout: TimeInterval = 8

  /// One attempt, never throws. Returns true when the server answered 2xx; nothing depends on it
  /// yet, but a caller that wants to know should not have to re-derive it.
  @discardableResult
  public static func post(code: String?, url: String?, at date: Date) async -> Bool {
    guard let code = code, !code.isEmpty,
          let raw = url, raw.hasPrefix("https://"),
          let endpoint = URL(string: raw) else { return false }
    var req = URLRequest(url: endpoint, timeoutInterval: timeout)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let iso = ISO8601DateFormatter().string(from: date)
    guard let body = try? JSONSerialization.data(withJSONObject: ["code": code, "tapped_at": iso]) else { return false }
    req.httpBody = body
    // The server's first tap stands; a failure here falls back to the drain.
    guard let result = try? await URLSession.shared.data(for: req),
          let http = result.1 as? HTTPURLResponse else { return false }
    return (200..<300).contains(http.statusCode)
  }
}

/// The hand-off between the intent (which runs in a short, unspecified slice of background time)
/// and the JS layer (which owns the signed code and the retry queue).
///
/// App Group storage rather than `UserDefaults.standard`: the widget extension and the app are
/// separate processes with separate containers, and the suite is the only thing both can see.
public enum RollCallPendingStore {
  /// Must match the App Group created in the Apple Developer portal and declared on BOTH targets.
  public static let suiteName = "group.com.onstandard.app"
  static let key = "rollcall.pendingTaps"

  /// Posted in-process the moment a tap is recorded. A `LiveActivityIntent` (and the AlarmKit
  /// intents) run in the APP's process, so when the app is already running the module can hear
  /// this and drain the store now, instead of the tap sitting there until the next cold start
  /// while the roll call reads as unanswered. Nobody listens in the extension process, and that is
  /// fine: there the tap waits for the app, which is what it always did.
  public static let didRecord = Notification.Name("app.onstandard.rollcall.pendingTapRecorded")

  /// Append one tap. Deliberately additive and tiny: this runs inside `perform()`, which Apple
  /// gives no documented time budget, so it does no I/O beyond one defaults write.
  ///
  /// `board` marks a tap from the alarm's own button, which opens OnStandard: the app lands on
  /// that morning's team board (#rollcall-board/<instanceId>) after draining it. Stop and the
  /// card's button leave it false and open nothing.
  public static func record(instanceId: String, at date: Date, board: Bool = false) {
    guard !instanceId.isEmpty, let defaults = UserDefaults(suiteName: suiteName) else { return }
    var pending = defaults.array(forKey: key) as? [[String: Any]] ?? []
    // One entry per instance: pressing twice is one answer, and the first tap is the one that
    // counts, exactly as the server's first-tap-wins rule already says.
    guard !pending.contains(where: { $0["instanceId"] as? String == instanceId }) else { return }
    var entry: [String: Any] = ["instanceId": instanceId, "at": date.timeIntervalSince1970 * 1000]
    if board { entry["board"] = true }
    pending.append(entry)
    defaults.set(pending, forKey: key)
    NotificationCenter.default.post(
      name: didRecord, object: nil,
      userInfo: ["instanceId": instanceId, "at": date.timeIntervalSince1970 * 1000, "board": board]
    )
  }

  /// Read and clear. Called by the module when the app next runs.
  public static func drain() -> [[String: Any]] {
    guard let defaults = UserDefaults(suiteName: suiteName) else { return [] }
    let pending = defaults.array(forKey: key) as? [[String: Any]] ?? []
    if !pending.isEmpty { defaults.removeObject(forKey: key) }
    return pending
  }
}
