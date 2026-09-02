import SwiftUI

#if canImport(ActivityKit) && canImport(WidgetKit)
import ActivityKit
import WidgetKit

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
    }
  }

  private func headline(_ context: ActivityViewContext<RollCallAttributes>) -> String {
    let phase = RollCallPhase.from(context.state.phase)
    switch phase {
    case .initial:  return context.attributes.coachName.isEmpty ? context.attributes.title : context.attributes.coachName
    case .reminder: return context.attributes.title
    case .late:     return "You're late"
    case .answered: return "Checked in"
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

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(kicker)
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.4)
            .foregroundStyle(.white.opacity(0.55))
          RollCallClock(state: context.state, palette: palette, size: 40)
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
    .padding(.vertical, 14)
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

  /// One dominant action. It is NOT the primary way to answer: on a locked device Apple makes
  /// buttons inactive until the person authenticates, so the notification's action button is what
  /// works at 6 AM on a nightstand. This one is for the phone already in a hand, where Face ID has
  /// cleared the lock with a glance.
  private var checkInButton: some View {
    Button(intent: RollCallCheckInIntent(instanceId: context.attributes.instanceId)) {
      Text(phase == .late ? "CHECK IN" : "I'M UP")
        .font(.system(size: 14, weight: .heavy))
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .frame(height: 40)
        .background(Capsule().fill(palette.button))
    }
    .buttonStyle(.plain)
  }

  private var title: String {
    switch phase {
    case .initial:
      return context.attributes.coachName.isEmpty ? context.attributes.title : context.attributes.coachName
    case .reminder: return context.attributes.title
    case .late:     return "You're late"
    case .answered: return "Checked in"
    case .missed:   return "Missed"
    }
  }

  private var eyebrow: String {
    switch phase {
    case .initial:  return context.attributes.title.uppercased()
    case .reminder: return "ONSTANDARD · COACH IS WAITING"
    case .late:     return "\(context.attributes.title.uppercased()) · ONSTANDARD"
    case .answered, .missed: return context.attributes.title.uppercased()
    }
  }

  private var kicker: String {
    switch phase {
    case .initial:  return "UP BY"
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
    case .answered: return "Checked in at \(Self.clock.string(from: context.state.checkedIn ?? Date()))."
    case .missed:   return "The roll call closed."
    }
  }

  private static let clock: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "h:mm a"
    return f
  }()
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
        // Before anything is urgent the deadline itself is the number: a time to be up BY, not a
        // countdown. A countdown from six minutes out reads as pressure the moment should not have.
        Text(state.deadline, style: .time)
      case .reminder:
        Text(timerInterval: Date()...state.deadline, countsDown: true)
      case .late:
        Text(timerInterval: state.deadline...state.closes, countsDown: false)
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
