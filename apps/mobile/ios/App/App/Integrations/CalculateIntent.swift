import AppIntents
import SwiftUI
import WidgetKit

/// "Calculate" for Siri, Shortcuts, Spotlight and the Action button. Simple arithmetic, percentages, tips and
/// unit conversions are answered inline (spoken + snippet) by the bundled calculator without opening the app;
/// anything else ("solve x^2 = 4", graphs, currency) continues in Lemma with the question filled in.
@available(iOS 17.0, *)
struct CalculateIntent: AppIntent, ForegroundContinuableIntent {
    static let title: LocalizedStringResource = "Calculate"
    static let description = IntentDescription(
        "Works out a calculation, percentage, tip or unit conversion, like “18% tip on 64”, “5 km in miles” or “sqrt 2”. Bigger questions open Lemma.",
        categoryName: "Calculate",
        searchKeywords: ["math", "calculator", "percent", "tip", "convert", "units"]
    )
    static var openAppWhenRun: Bool { false }

    @Parameter(
        title: "Calculation",
        description: "What to work out, in words or symbols.",
        inputOptions: String.IntentInputOptions(keyboardType: .default, capitalizationType: .none, autocorrect: false),
        requestValueDialog: IntentDialog("What should I calculate?")
    )
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Calculate \(\.$query)")
    }

    init() {}

    init(query: String) {
        self.query = query
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let question = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let answer = InlineCalculator.shared.answer(question)
        guard answer.ok, let display = answer.display else {
            let link = LemmaLink.calculate(question)
            throw needsToContinueInForegroundError(IntentDialog("I’ll open Lemma for that.")) {
                await MainActor.run { LemmaIntentRouting.open?(link) }
            }
        }
        SharedStore.lastResult = LastResult(query: question, display: display, date: Date())
        WidgetCenter.shared.reloadAllTimelines()

        let approx = answer.approximate == true ? "about " : ""
        let spoken = answer.spoken ?? display
        return .result(
            value: display,
            dialog: IntentDialog(full: "\(approx.capitalizedFirst)\(spoken)", supporting: "\(approx.capitalizedFirst)\(display)"),
            view: CalculationSnippet(question: question, expression: answer.expression ?? question, display: display, fraction: answer.fraction, approximate: answer.approximate == true)
        )
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

@available(iOS 17.0, *)
struct CalculationSnippet: View {
    var question: String
    var expression: String
    var display: String
    var fraction: String?
    var approximate: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(expression)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(approximate ? "≈" : "=")
                    .font(.title2.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(display)
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                    .minimumScaleFactor(0.4)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
            if let fraction {
                Text(fraction).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
    }
}

/// Siri phrases and Spotlight / Shortcuts / Action button tiles. Siri asks “What should I calculate?” after
/// “Ask Lemma”, since free text cannot be part of an App Shortcut phrase.
@available(iOS 17.0, *)
struct LemmaShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor { .navy }

    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CalculateIntent(),
            phrases: [
                "Calculate with \(.applicationName)",
                "Ask \(.applicationName)",
                "\(.applicationName) calculate",
                "Do math with \(.applicationName)",
                "Work something out with \(.applicationName)",
            ],
            shortTitle: "Calculate",
            systemImageName: "plus.forwardslash.minus"
        )
        AppShortcut(
            intent: OpenVoiceCalculationIntent(),
            phrases: [
                "Voice calculation in \(.applicationName)",
                "Speak to \(.applicationName)",
                "Talk to \(.applicationName)",
            ],
            shortTitle: "Voice Calculation",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: OpenCalculatorIntent(),
            phrases: [
                "Open the \(.applicationName) calculator",
            ],
            shortTitle: "Open Calculator",
            systemImageName: "function"
        )
    }
}
