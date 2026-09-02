import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// OnStandard — the wire contract for the Wake-Up Roll Call Live Activity.
///
/// THIS FILE MUST BE COMPILED INTO BOTH TARGETS: the app (which starts and updates activities) and
/// the widget extension (which draws them). ActivityKit matches an incoming push to a running
/// activity by the *name* of this type, and the server names it as a literal string, so the three
/// spellings have to agree:
///
///   Swift                          `RollCallAttributes`
///   push `attributes-type`         "RollCallAttributes"  (LIVE_ATTRIBUTES_TYPE)
///   push `content-state` keys      the ContentState properties below
///
/// A mismatch does not throw anywhere. iOS simply drops the push and no card appears, which looks
/// exactly like the feature not being installed. That is the entire reason this file is one page
/// of plain properties with no cleverness in it.
///
/// EPOCH SECONDS, NOT `Date`. Apple: "don't use any custom JSON encoding strategies... Custom
/// encoding strategies will result in update failures." Swift's default strategy encodes `Date` as
/// seconds since the 2001 reference date, which no server sends by accident and every server gets
/// wrong. `Double` sidesteps the whole class of bug; `asDate` converts at the point of use.
@available(iOS 16.1, *)
public struct RollCallAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "initial" | "reminder" | "late" | "answered" | "missed". A plain String rather than an enum
    /// so an unknown value from a newer server decodes instead of failing the whole push; the view
    /// falls back to the calm presentation.
    public var phase: String

    /// Grace end. The countdown runs to this, then counts up past it.
    public var deadlineEpoch: Double

    /// Close. After this no answer is accepted.
    public var closesEpoch: Double

    /// When the athlete answered, or nil.
    public var checkedInEpoch: Double?

    /// The coach's message, already trimmed by the server to one lock-screen line.
    public var line: String

    public init(phase: String, deadlineEpoch: Double, closesEpoch: Double,
                checkedInEpoch: Double? = nil, line: String = "") {
      self.phase = phase
      self.deadlineEpoch = deadlineEpoch
      self.closesEpoch = closesEpoch
      self.checkedInEpoch = checkedInEpoch
      self.line = line
    }

    public var deadline: Date { Date(timeIntervalSince1970: deadlineEpoch) }
    public var closes: Date { Date(timeIntervalSince1970: closesEpoch) }
    public var checkedIn: Date? { checkedInEpoch.map { Date(timeIntervalSince1970: $0) } }
  }

  /// The roll-call occurrence this card belongs to. The button's intent posts it back to the
  /// server, and the app uses it to key the activity's update token.
  public var instanceId: String

  /// The roll call's own name, e.g. "Wake-Up Roll Call".
  public var title: String

  /// The coach's display name. Empty when the commitment has no named owner, in which case the
  /// card leads with the roll call's name instead and never invents a person.
  public var coachName: String

  /// One or two letters for the avatar circle. A Live Activity cannot reach the network, so a
  /// photo is only ever shown when the app has already cached one into the App Group; these
  /// initials are what the card falls back to, which is most of the time.
  public var coachInitials: String

  public init(instanceId: String, title: String, coachName: String, coachInitials: String) {
    self.instanceId = instanceId
    self.title = title
    self.coachName = coachName
    self.coachInitials = coachInitials
  }
}

/// The five states, resolved from the wire string. Kept out of the Codable type on purpose: an
/// unknown phase must decode, not throw.
@available(iOS 16.1, *)
public enum RollCallPhase: String {
  case initial, reminder, late, answered, missed

  public static func from(_ raw: String) -> RollCallPhase {
    RollCallPhase(rawValue: raw) ?? .initial
  }

  /// Whether the roll call can still be answered in this state.
  public var isOpen: Bool {
    switch self {
    case .initial, .reminder, .late: return true
    case .answered, .missed: return false
    }
  }
}
#endif
