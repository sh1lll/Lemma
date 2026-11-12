import AppIntents
import Foundation

/// Where the app process routes deep links. Set by the app at launch; nil in the widget extension, which only
/// declares these intents (for Control Center controls and widget buttons) — the system runs them in the app
/// because `openAppWhenRun` is true.
enum LemmaIntentRouting {
    @MainActor static var open: ((LemmaLink) -> Void)?
}

/// "Open Lemma": brings the calculator up, ready to type. Used by the Control Center control and widgets.
@available(iOS 16.0, *)
struct OpenCalculatorIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Calculator"
    static let description = IntentDescription("Opens the Lemma calculator.")
    static var openAppWhenRun: Bool { true }

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        LemmaIntentRouting.open?(.open)
        return .result()
    }
}

/// "Open voice calculation": opens Lemma and starts listening (the web app's ?listen=1).
@available(iOS 16.0, *)
struct OpenVoiceCalculationIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Voice Calculation"
    static let description = IntentDescription("Opens Lemma and starts listening for a spoken calculation.")
    static var openAppWhenRun: Bool { true }

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        LemmaIntentRouting.open?(.listen)
        return .result()
    }
}
