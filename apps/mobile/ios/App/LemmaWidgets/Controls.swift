import AppIntents
import SwiftUI
import WidgetKit

/// Control Center / Lock Screen / Action button control: opens the calculator.
@available(iOS 18.0, *)
struct CalculatorControl: ControlWidget {
    static let kind = "app.lemma.mobile.control.calculator"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenCalculatorIntent()) {
                Label("Lemma", systemImage: "plus.forwardslash.minus")
            }
        }
        .displayName("Calculator")
        .description("Open the Lemma calculator.")
    }
}

/// Control: opens Lemma listening for a spoken calculation.
@available(iOS 18.0, *)
struct VoiceControl: ControlWidget {
    static let kind = "app.lemma.mobile.control.voice"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenVoiceCalculationIntent()) {
                Label("Speak to Lemma", systemImage: "mic.fill")
            }
        }
        .displayName("Voice Calculation")
        .description("Open Lemma and speak a calculation.")
    }
}
