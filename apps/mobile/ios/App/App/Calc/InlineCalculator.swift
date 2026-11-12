import Foundation
import JavaScriptCore

/// Answers simple questions natively by running Lemma's own TypeScript calculator (math-core, unit-engine,
/// finance-engine), bundled as lemma-calc.js by apps/mobile/scripts/build-native-calc.mjs, in JavaScriptCore.
/// Used by the Calculate App Intent (Siri, Shortcuts, Spotlight, Action button) and the share extension so
/// arithmetic, percentages, tips and unit conversions come back without starting the web view.
final class InlineCalculator {
    struct Answer: Decodable, Equatable {
        var ok: Bool
        var kind: String?
        var display: String?
        var expression: String?
        var spoken: String?
        var approximate: Bool?
        var fraction: String?
        var error: String?

        static func failure(_ message: String) -> Answer {
            Answer(ok: false, kind: nil, display: nil, expression: nil, spoken: nil, approximate: nil, fraction: nil, error: message)
        }
    }

    static let shared = InlineCalculator()

    private let queue = DispatchQueue(label: "app.lemma.inline-calculator")
    private var context: JSContext?
    private var answerFn: JSValue?
    private(set) var loadError: String?

    init(bundle: Bundle = .main) {
        queue.sync { self.load(bundle: bundle) }
    }

    private func load(bundle: Bundle) {
        guard let url = bundle.url(forResource: "lemma-calc", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            loadError = "lemma-calc.js is missing from the bundle"
            return
        }
        guard let ctx = JSContext() else {
            loadError = "JavaScriptCore is unavailable"
            return
        }
        var exception: String?
        ctx.exceptionHandler = { _, value in exception = value?.toString() }
        ctx.evaluateScript(source, withSourceURL: url)
        let fn = ctx.objectForKeyedSubscript("Lemma")?.objectForKeyedSubscript("answer")
        if let exception {
            loadError = "lemma-calc.js failed to load: \(exception)"
            return
        }
        guard let fn, !fn.isUndefined else {
            loadError = "lemma-calc.js does not define Lemma.answer"
            return
        }
        context = ctx
        answerFn = fn
    }

    /// Thread-safe; a few milliseconds for typical input.
    func answer(_ input: String) -> Answer {
        queue.sync {
            guard let fn = answerFn else { return .failure(loadError ?? "calculator unavailable") }
            guard let json = fn.call(withArguments: [input])?.toString(),
                  let data = json.data(using: .utf8),
                  let decoded = try? JSONDecoder().decode(Answer.self, from: data) else {
                return .failure("calculator returned no answer")
            }
            return decoded
        }
    }
}
