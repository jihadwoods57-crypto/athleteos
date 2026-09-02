import SwiftUI
import WidgetKit

/// OnStandard — the widget extension's entry point.
///
/// A widget extension needs exactly one `@main` WidgetBundle, and it belongs to the EXTENSION
/// only. It is deliberately not in modules/rollcall-live/ios/: an `@main` compiled into the app
/// target would collide with the app's own entry point.
///
/// The availability guard is what lets this extension exist at all on a project whose deployment
/// target is below 16.2. `RollCallLiveActivity` is `@available(iOS 16.2, *)`, and a WidgetBundle
/// body cannot itself be annotated, so the check goes inside: on anything older the bundle is
/// simply empty, which is a valid extension that never shows a card.
@main
struct RollCallWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      RollCallLiveActivity()
    }
  }
}
