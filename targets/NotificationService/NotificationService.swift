import Foundation
import UserNotifications

#if canImport(AlarmKit)
import AlarmKit
#endif

/// OnStandard: the roll-call Notification Service Extension (roll call v3, 2026-09-24).
///
/// WHY THIS EXISTS. Only OnStandard can put an AlarmKit alarm on a phone, and until now it did so
/// only while running (Home load, syncWakeAlarms). A coach who moved Thursday's roll call at 8 PM
/// reached an athlete whose app last ran at 6:28 PM, and no alarm rang (2026-09-24). iOS runs this
/// extension, in OnStandard's name, for every push carrying `mutable-content`, BEFORE the banner
/// shows, even after a force-quit. If AlarmKit lets an extension schedule (the spike decides), the
/// assignment push arms the alarm itself.
///
/// IN ORDER, inside Apple's ~30 second budget:
///   1. read `rc` (RollCallArmPlan); any other push passes through untouched;
///   2. cancel `rc.cancel`, arm `rc.arm` with the SAME scheduler the app uses (mirrored here byte
///      for byte), so the alarm, its buttons and its window code are identical either way;
///   3. rewrite the banner to `rc.set` ("Alarm set ✓") ONLY when at least one alarm armed and every
///      requested alarm armed, so the lock screen tells the truth about THIS phone; otherwise the
///      server's text stays;
///   4. post each armed morning's window code to roll-call-ack `{ action: "armed" }`, so the coach
///      sees "Alarm set" without the athlete opening anything.
final class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var handler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let mutable = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
    lock.lock(); handler = contentHandler; content = mutable; lock.unlock()

    guard let plan = RollCallArmPlan(userInfo: request.content.userInfo) else {
      // The spike's own push only (its title is fixed by scripts/rollcall-nse-spike.mjs): say that
      // the extension RAN but found no schedule, and where it looked. Every other push is untouched.
      if request.content.title == "Roll call test" {
        let keys = request.content.userInfo.keys.map { "\($0)" }.sorted().joined(separator: ",")
        setBody("SPIKE ran, no rc found · keys \(keys)")
      }
      finish()
      return
    }

    Task {
      let outcome = await RollCallPushArmer.run(plan)
      if let body = outcome.banner(for: plan) { self.setBody(body) }
      await RollCallPushArmer.report(outcome, plan: plan)
      self.finish()
    }
  }

  /// Apple is about to kill the extension: deliver whatever the banner says now.
  override func serviceExtensionTimeWillExpire() { finish() }

  private func setBody(_ body: String) {
    lock.lock(); content?.body = body; lock.unlock()
  }

  /// Exactly once, from whichever path gets here first.
  private func finish() {
    lock.lock()
    let h = handler
    let c = content
    handler = nil
    lock.unlock()
    if let h = h, let c = c { h(c) }
  }
}

/// The schedule the server put in the push (`data.rc`). Keys are the wire contract with
/// supabase/functions/_shared/rollcall-notice.ts armPayload(); nse-contract.test.ts compares them.
struct RollCallArmPlan {
  struct Item {
    let instanceId: String
    let atMs: Double
    let code: String?
  }

  let kind: String
  let title: String
  let label: String
  let url: String?
  let arm: [Item]
  let cancel: [String]
  let setBody: String?
  let diag: Bool

  init?(userInfo: [AnyHashable: Any]) {
    guard let rc = RollCallArmPlan.find(in: userInfo), RollCallArmPlan.int(rc["v"]) == 1 else { return nil }
    kind = rc["kind"] as? String ?? ""
    title = (rc["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Wake up"
    label = (rc["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? RollCallAlarm.secondaryButtonLabel
    url = (rc["url"] as? String).flatMap { $0.hasPrefix("https://") ? $0 : nil }
    // The closure's type is spelled out and the helpers are named by the type, not `Self`: this
    // runs before every stored property is set, and nothing here compiles on the machine that
    // wrote it, so no inference or capture question is left to the compiler.
    arm = (rc["arm"] as? [[String: Any]] ?? []).compactMap { (x: [String: Any]) -> Item? in
      guard let id = x["i"] as? String, !id.isEmpty, let at = RollCallArmPlan.double(x["at"]) else { return nil }
      let code = (x["c"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      return Item(instanceId: id, atMs: at, code: code)
    }
    cancel = (rc["cancel"] as? [String] ?? []).filter { !$0.isEmpty }
    setBody = (rc["set"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    diag = RollCallArmPlan.int(rc["diag"]) == 1
  }

  /// Expo delivers custom `data` under "body" on iOS; "data" and the top level are read too, so a
  /// change in where Expo nests it degrades to "not found" (the spike banner names the keys) rather
  /// than to a crash.
  static func find(in u: [AnyHashable: Any]) -> [String: Any]? {
    if let rc = u["rc"] as? [String: Any] { return rc }
    for key in ["body", "data"] {
      if let d = u[key] as? [String: Any], let rc = d["rc"] as? [String: Any] { return rc }
      if let s = u[key] as? String, let raw = s.data(using: .utf8),
         let d = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any],
         let rc = d["rc"] as? [String: Any] { return rc }
    }
    return nil
  }

  static func int(_ v: Any?) -> Int? { (v as? NSNumber)?.intValue ?? (v as? Int) }
  static func double(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue ?? (v as? Double) }
}

/// What happened on THIS phone.
struct RollCallArmOutcome {
  var armed: [RollCallArmPlan.Item] = []
  var wanted = 0
  var failed = 0
  var cancelled = 0
  var auth = "unsupported"
  var error: String?

  /// The banner to show, or nil to keep the server's own text. `diag` (the spike) always reports.
  ///
  /// "Alarm set" is a claim about THIS phone, so it is written only when this extension actually
  /// armed at least one alarm and every morning it was asked for. A cancel-only push, a push whose
  /// mornings were all too close to arm, a denied or undetermined permission and any AlarmKit
  /// failure all keep the server's own text ("Open OnStandard to set your alarm").
  func banner(for plan: RollCallArmPlan) -> String? {
    if plan.diag {
      return "SPIKE \(armed.count)/\(wanted) armed · cancelled \(cancelled) · auth \(auth)"
        + (error.map { " · \($0)" } ?? "")
    }
    guard auth != "unsupported", failed == 0, armed.count == wanted, !armed.isEmpty else { return nil }
    return plan.setBody
  }
}

enum RollCallPushArmer {
  /// Cancel, then arm every future morning. Never throws. A morning under 30 seconds away is not
  /// armed (it would ring during delivery) and does not count as wanted.
  static func run(_ plan: RollCallArmPlan, nowMs: Double = Date().timeIntervalSince1970 * 1000) async -> RollCallArmOutcome {
    var out = RollCallArmOutcome()
    let future = plan.arm.filter { $0.atMs > nowMs + 30_000 }
    out.wanted = future.count
    #if canImport(AlarmKit)
    if #available(iOS 26.1, *) {
      out.auth = RollCallAlarmScheduler.authorizationState()
      for id in plan.cancel {
        RollCallAlarmScheduler.cancel(instanceId: id)
        out.cancelled += 1
      }
      // Never prompt from here: an extension has no screen to explain the question on. The app's
      // Continue primer (js/alarm-primer.js) is the only place alarms are asked for.
      guard out.auth == "authorized" else { return out }
      for item in future {
        do {
          _ = try await RollCallAlarmScheduler.scheduleAt(
            instanceId: item.instanceId, atMs: item.atMs, title: plan.title, buttonLabel: plan.label,
            ackCode: item.code, ackUrl: plan.url
          )
          out.armed.append(item)
        } catch {
          out.failed += 1
          out.error = String(String(describing: error).prefix(80))
        }
      }
    }
    #endif
    return out
  }

  /// Tell the server which mornings this phone will ring for. One short attempt each, in parallel;
  /// a failure only means the coach sees "Seen but not set" until the next app open reports it.
  static func report(_ out: RollCallArmOutcome, plan: RollCallArmPlan) async {
    guard let raw = plan.url, let url = URL(string: raw) else { return }
    await withTaskGroup(of: Void.self) { group in
      for item in out.armed {
        guard let code = item.code else { continue }
        group.addTask {
          var req = URLRequest(url: url, timeoutInterval: 5)
          req.httpMethod = "POST"
          req.setValue("application/json", forHTTPHeaderField: "Content-Type")
          // The annotation is required: a String/Bool literal passed straight to an `Any` parameter
          // is a compile ERROR ("heterogeneous collection literal"), not a warning.
          let body: [String: Any] = ["action": "armed", "code": code, "armed": true]
          req.httpBody = try? JSONSerialization.data(withJSONObject: body)
          _ = try? await URLSession.shared.data(for: req)
        }
      }
    }
  }
}
