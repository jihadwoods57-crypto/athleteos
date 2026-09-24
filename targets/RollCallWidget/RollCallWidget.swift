import SwiftUI

#if canImport(ActivityKit) && canImport(WidgetKit)
import ActivityKit
import WidgetKit
// Required even though nothing here names an AppIntents type directly: the button's initializer is
// constrained to `AppIntent`, and under Swift 6's MemberImportVisibility a transitive load is no
// longer enough to satisfy that.
import AppIntents

/// OnStandard — the Wake-Up Roll Call card, as drawn on the lock screen and in the Dynamic Island.
///
/// THIS FILE BELONGS TO THE WIDGET EXTENSION TARGET, not the app. See
/// docs/go-live/ROLLCALL-LIVE-ACTIVITY.md for how the target is added; it is deliberately NOT
/// wired into app.json, because an app-extension target that fails to compile fails the whole
/// production build, and nothing here has been through a Swift compiler.
///
/// TWO CONSTRAINTS SHAPED EVERY DECISION BELOW:
///
///   160 POINTS. Apple truncates a lock-screen Live Activity past that height. So the card is one
///   header row and one number row, and the button sits BESIDE the number rather than under it.
///
///   NO CUSTOM FONTS. Bundling a TTF into a widget extension is a documented way to make a Live
///   Activity fail to start with `archiveTooLarge` — silently, with `Activity.request` still
///   returning success. OnStandard's Archivo Expanded numerals are therefore NOT used here; the
///   card uses the system font with `.monospacedDigit()`, which is what keeps a ticking countdown
///   from jittering. This is the one place in the product where the brand's numerals are given up
///   on purpose, and it buys a card that actually appears.
@available(iOS 16.2, *)
struct RollCallLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RollCallAttributes.self) { context in
      RollCallLockScreenView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
        // The card body's tap opens that morning's team board (ProtoApp maps this URL to
        // #rollcall-board/<id>). The I'm Up button keeps its own intent.
        .widgetURL(URL(string: "onstandard://roll-call/\(context.attributes.instanceId)"))
    } dynamicIsland: { context in
      let palette = RollCallPalette(phase: RollCallPhase.from(context.state.phase))
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          RollCallAvatar(initials: context.attributes.coachInitials, palette: palette)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RollCallClock(state: context.state, palette: palette, size: 30)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(headline(context))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white.opacity(0.9))
            .lineLimit(1)
        }
      } compactLeading: {
        Image(systemName: palette.symbol).foregroundStyle(palette.ink)
      } compactTrailing: {
        RollCallClock(state: context.state, palette: palette, size: 15)
      } minimal: {
        Image(systemName: palette.symbol).foregroundStyle(palette.ink)
      }
      .widgetURL(URL(string: "onstandard://roll-call/\(context.attributes.instanceId)"))
    }
  }

  private func headline(_ context: ActivityViewContext<RollCallAttributes>) -> String {
    let phase = RollCallPhase.from(context.state.phase)
    switch phase {
    case .initial:  return context.attributes.coachName.isEmpty ? context.attributes.title : context.attributes.coachName
    case .reminder: return context.attributes.title
    case .late:     return "You're late"
    case .answered: return RollCallCopy.answeredHeadline(place: context.state.place)
    case .missed:   return "Missed"
    }
  }
}

// MARK: - the lock screen card

@available(iOS 16.2, *)
struct RollCallLockScreenView: View {
  let context: ActivityViewContext<RollCallAttributes>

  private var phase: RollCallPhase { RollCallPhase.from(context.state.phase) }
  private var palette: RollCallPalette { RollCallPalette(phase: phase) }

  /// Whether the team row shows. A card from a server that predates the count carries 0 of 0 and
  /// draws exactly the card it always drew.
  private var showsTeam: Bool { context.state.teamTotal > 0 }

  /// THE 160-POINT BUDGET, measured in SF line heights (about 1.19x the point size): padding 24,
  /// header 31, gap 8, kicker 13 + 2 + clock + 2 + team row 13, gap 8, line 16. At 40 pt the clock
  /// plus the team row came to about 164, so the clock gives up 6 pt ONLY on a card that shows the
  /// team (about 157, the same margin the card had before the row existed). A card without the row
  /// keeps the 40 pt clock and comes to about 149.
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      header
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(kicker)
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.4)
            .foregroundStyle(.white.opacity(0.55))
          RollCallClock(state: context.state, palette: palette, size: showsTeam ? 34 : 40)
          if showsTeam {
            // Quiet on purpose: the clock is the card, this is the room around it.
            Text("\(context.state.teamUp) of \(context.state.teamTotal) up")
              .font(.system(size: 11, weight: .semibold))
              .monospacedDigit()
              .foregroundStyle(.white.opacity(0.55))
              .lineLimit(1)
          }
        }
        Spacer(minLength: 0)
        if phase.isOpen { checkInButton }
      }
      if !line.isEmpty {
        Text(line)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white.opacity(0.75))
          .lineLimit(1)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  private var header: some View {
    HStack(spacing: 10) {
      RollCallAvatar(initials: context.attributes.coachInitials, palette: palette)
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(phase == .late ? palette.ink : .white)
          .lineLimit(1)
        Text(eyebrow)
          .font(.system(size: 10, weight: .heavy))
          .tracking(1.3)
          .foregroundStyle(palette.ink)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
  }

  /// One dominant action. Checks in AND opens the team board, the same as both alarm buttons (roll
  /// call v3). On a locked phone Apple keeps Live Activity buttons inactive until the person
  /// authenticates, so this is for the phone already in a hand; the alarm is what answers from a
  /// nightstand.
  ///
  /// iOS 17 gates BOTH halves of this: `Button(intent:)` and `LiveActivityIntent` itself. The card
  /// as a whole still runs on 16.2, so the availability check is here rather than on the view —
  /// a 16.x athlete gets the countdown card with no button, and answers from the notification,
  /// which is the path that works while locked anyway. `@ViewBuilder` is what lets this return
  /// nothing on 16.x while still satisfying `some View`.
  @ViewBuilder
  private var checkInButton: some View {
    if #available(iOS 17.0, *) {
      // The window code rides with the button, so the tap posts itself as OnStandard opens.
      Button(intent: RollCallAttackDayIntent(
        instanceId: context.attributes.instanceId,
        ackCode: context.attributes.ackCode,
        ackUrl: context.attributes.ackUrl
      )) {
        Text(phase == .late ? "CHECK IN" : (context.attributes.actionLabel ?? "I’M UP").uppercased())
          .font(.system(size: 14, weight: .heavy))
          .foregroundStyle(.white)
          .padding(.horizontal, 16)
          .frame(height: 40)
          .background(Capsule().fill(palette.button))
      }
      .buttonStyle(.plain)
    }
  }

  private var title: String {
    switch phase {
    case .initial:
      return context.attributes.coachName.isEmpty ? context.attributes.title : context.attributes.coachName
    case .reminder: return context.attributes.title
    case .late:     return "You're late"
    case .answered: return RollCallCopy.answeredHeadline(place: context.state.place)
    case .missed:   return "Missed"
    }
  }

  private var eyebrow: String {
    switch phase {
    case .initial:  return context.attributes.title.uppercased()
    case .reminder: return "ONSTANDARD · \(context.attributes.title.uppercased())"
    case .late:     return "\(context.attributes.title.uppercased()) · ONSTANDARD"
    case .answered, .missed: return context.attributes.title.uppercased()
    }
  }

  private var kicker: String {
    switch phase {
    case .initial:  return "UP BY \(Self.clock.string(from: context.state.deadline))"
    case .reminder: return "LEFT TO CHECK IN"
    case .late:     return "LATE BY"
    case .answered: return "ON STANDARD"
    case .missed:   return "NO ANSWER"
    }
  }

  private var line: String {
    switch phase {
    case .initial:  return context.state.line
    case .reminder: return "On Standard until \(Self.clock.string(from: context.state.deadline))."
    case .late:     return "Check in now. Your coach can see this."
    case .answered:
      // What the answer banked, once it counts. Until then (or from an older server), the time.
      if let points = context.state.points, points > 0 { return "+\(points) to today's score" }
      return "Checked in at \(Self.clock.string(from: context.state.checkedIn ?? Date()))."
    case .missed:   return "Closed with no answer. Tomorrow starts fresh."
    }
  }

  private static let clock: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "h:mm a"
    return f
  }()
}

// MARK: - words

/// The answered card's words, shared by the lock screen and the Dynamic Island so the two never
/// say different things about the same answer.
@available(iOS 16.2, *)
enum RollCallCopy {
  /// "You're up · 4th", or "You're up" when there is no place yet (an answer under review, or a
  /// server that predates the board).
  static func answeredHeadline(place: Int?) -> String {
    guard let place = place, place > 0 else { return "You're up" }
    return "You're up · \(ordinal(place))"
  }

  /// English ordinals, spelled out by hand so the card reads the same on every locale the app
  /// ships in (the rest of the card is English too). 11th, 12th and 13th are the exceptions.
  static func ordinal(_ n: Int) -> String {
    let tens = n % 100
    if tens >= 11 && tens <= 13 { return "\(n)th" }
    switch n % 10 {
    case 1: return "\(n)st"
    case 2: return "\(n)nd"
    case 3: return "\(n)rd"
    default: return "\(n)th"
    }
  }
}

// MARK: - the number

/// The one element that has to be readable at arm's length in a dark room.
///
/// `Text(timerInterval:countsDown:)` is what makes this work without a push: iOS ticks it itself,
/// so the card stays truthful while the phone is face down and OnStandard is not running. Before
/// the deadline it counts DOWN to it; after, it counts UP from it, which is the "3 min late" the
/// design asks for out of the same primitive.
@available(iOS 16.2, *)
struct RollCallClock: View {
  let state: RollCallAttributes.ContentState
  let palette: RollCallPalette
  let size: CGFloat

  var body: some View {
    Group {
      switch RollCallPhase.from(state.phase) {
      case .answered:
        Text(state.checkedIn ?? Date(), style: .time)
      case .missed:
        Text("Missed")
      case .initial:
        // The minutes left to be up, ticked by iOS. This used to print the deadline as a static
        // time, and the founder photographed the result: "UP BY 4:50" still sitting on a lock
        // screen at 5:02, because no push had arrived to change it. A countdown stays true on its
        // own, and the deadline itself is in the kicker beside it. Clamped like the other two.
        let now = Date()
        Text(timerInterval: now...max(state.deadline, now.addingTimeInterval(1)), countsDown: true)
      case .reminder:
        // `a...b` TRAPS when b < a, and the widget extension trapping means a blank card. This is
        // not a hypothetical: the steady state after a dropped or delayed phase push is a deadline
        // already in the past while the content state still says "reminder", and the system
        // re-renders on its own timeline. Clamp rather than trust the wire.
        let now = Date()
        Text(timerInterval: now...max(state.deadline, now.addingTimeInterval(1)), countsDown: true)
      case .late:
        // Same trap from the other side: a payload carrying only one of the two instants leaves
        // the other at epoch zero.
        Text(
          timerInterval: state.deadline...max(state.closes, state.deadline.addingTimeInterval(1)),
          countsDown: false
        )
      }
    }
    .font(.system(size: size, weight: .heavy, design: .rounded))
    .monospacedDigit()
    .foregroundStyle(palette.ink)
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }
}

// MARK: - the avatar

@available(iOS 16.2, *)
struct RollCallAvatar: View {
  let initials: String
  let palette: RollCallPalette

  var body: some View {
    ZStack {
      Circle().fill(palette.button)
      Text(initials.isEmpty ? "OS" : initials)
        .font(.system(size: 12, weight: .heavy))
        .foregroundStyle(.white)
    }
    .frame(width: 30, height: 30)
  }
}

// MARK: - colour

/// The state's hue, straight from the proto's tokens (css/tokens.css). Blue is the CALM state
/// rather than green: green is status-only across the product, and blue-to-teal is the signature.
/// The button on the late card stays blue on purpose — it is the way out, not the verdict.
@available(iOS 16.2, *)
struct RollCallPalette {
  let phase: RollCallPhase

  var ink: Color {
    switch phase {
    case .initial:  return Color(red: 0.376, green: 0.647, blue: 0.980) // --blue-bright #60A5FA
    case .reminder: return Color(red: 0.961, green: 0.647, blue: 0.141) // --amber       #F5A524
    case .late:     return Color(red: 0.965, green: 0.341, blue: 0.341) // --red         #F65757
    case .answered: return Color(red: 0.204, green: 0.827, blue: 0.600) // --green       #34D399
    case .missed:   return Color(red: 0.965, green: 0.341, blue: 0.341)
    }
  }

  /// The action's fill. Blue everywhere except the reminder, where amber IS the card's identity.
  var button: Color {
    switch phase {
    case .reminder: return Color(red: 0.851, green: 0.467, blue: 0.024) // --amber-deep #D97706
    default:        return Color(red: 0.145, green: 0.388, blue: 0.922) // --blue-deep  #2563EB
    }
  }

  var symbol: String {
    switch phase {
    case .initial:  return "sun.horizon.fill"
    case .reminder: return "bell.fill"
    case .late:     return "exclamationmark.triangle.fill"
    case .answered: return "checkmark.circle.fill"
    case .missed:   return "xmark.circle.fill"
    }
  }
}
#endif
