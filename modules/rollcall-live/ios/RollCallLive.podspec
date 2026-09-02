require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RollCallLive'
  s.version        = '1.0.0'
  s.summary        = 'OnStandard Wake-Up Roll Call: Live Activity tokens and the check-in intent.'
  s.description    = 'Reports ActivityKit push-to-start and per-activity update tokens to JS, and hands off taps made on the Live Activity button.'
  s.author         = 'OnStandard'
  s.homepage       = 'https://onstandard.app'
  s.platforms      = { :ios => '15.1' }
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
  s.source_files = 'RollCallAttributes.swift', 'RollCallLiveModule.swift', 'RollCallCheckInIntent.swift'
end
