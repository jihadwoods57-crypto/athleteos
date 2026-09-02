Pod::Spec.new do |s|
  s.name           = 'RollCallLive'
  s.version        = '1.0.0'
  s.summary        = 'OnStandard Wake-Up Roll Call: Live Activity tokens and the check-in intent.'
  s.description    = 'Reports ActivityKit push-to-start and per-activity update tokens to JS, and hands off taps made on the Live Activity button.'
  s.author         = 'OnStandard'
  s.homepage       = 'https://onstandard.app'
  # 16.4 to match every SDK 57 podspec (ExpoModulesCore, Expo, EXApplication). Declaring a lower
  # floor here does not lower anything in practice, but it is a lie that surfaces the first time
  # something derives a deployment target from it: "compiling for iOS 15.1, but module
  # 'ExpoModulesCore' has a minimum deployment target of iOS 16.4".
  s.platforms      = { :ios => '16.4' }
  # Required. Without it `pod install` aborts with "Unable to determine Swift version for the
  # following pods" whenever the integrating target has no SWIFT_VERSION of its own.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # RollCallWidget.swift is deliberately EXCLUDED: it belongs to the widget extension target, not
  # to the app. Compiling a WidgetKit `Widget` into the app target is not an error, but it would
  # ship dead code in the binary and hide the fact that the extension is what actually draws.
  #
  # RollCallAttributes.swift and RollCallCheckInIntent.swift are compiled into the APP here, and
  # BOTH also need target membership in the extension: the extension draws the card and constructs
  # the intent, so it needs both types at compile time. See ROLLCALL-LIVE-ACTIVITY.md.
  s.source_files = 'RollCallAttributes.swift', 'RollCallLiveModule.swift', 'RollCallCheckInIntent.swift'
end
