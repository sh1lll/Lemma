import Foundation

/// Debug check of the JavaScriptCore calculator, run with the launch argument -LemmaSelfTest:
///   xcrun simctl launch --console-pty booted app.lemma.mobile -LemmaSelfTest
/// Prints one line per case and a PASS/FAIL summary. Optional -LemmaSelfTestQuery "<text>" answers one query.
enum InlineCalculatorSelfTest {
    static func runIfRequested(arguments: [String] = ProcessInfo.processInfo.arguments) {
        if let i = arguments.firstIndex(of: "-LemmaSelfTestQuery"), i + 1 < arguments.count {
            let a = InlineCalculator.shared.answer(arguments[i + 1])
            print("Lemma-SELFTEST query=\(arguments[i + 1]) ok=\(a.ok) display=\(a.display ?? "-") expression=\(a.expression ?? "-") error=\(a.error ?? "-")")
        }
        guard arguments.contains("-LemmaSelfTest") else { return }
        let start = Date()
        let cases: [(String, String?)] = [
            ("18% tip on 64", "$11.52"),
            ("5 km in miles", "3.10685596119 mi"),
            ("sqrt 2", "1.41421356237"),
            ("2+2", "4"),
            ("20% of 450 + 30", "120"),
            ("what is 15% off 80", "68"),
            ("72 f to c", "22.2222222222 °C"),
            ("split 120 between 4", "$30.00"),
            ("1/3", "0.333333333333"),
            ("solve x^2 = 4", nil),   // needs the app
            ("x = 3", nil),           // assignment: needs the app's session
        ]
        var failures = 0
        for (q, expected) in cases {
            let a = InlineCalculator.shared.answer(q)
            let pass = expected == nil ? !a.ok : (a.ok && a.display == expected)
            if !pass { failures += 1 }
            print("Lemma-SELFTEST \(pass ? "ok  " : "FAIL") \(q) -> \(a.ok ? (a.display ?? "") : "open app (\(a.error ?? ""))")")
        }
        let ms = Int(Date().timeIntervalSince(start) * 1000)
        print("Lemma-SELFTEST \(failures == 0 ? "PASS" : "FAIL") \(cases.count - failures)/\(cases.count) in \(ms) ms\(InlineCalculator.shared.loadError.map { " loadError=\($0)" } ?? "")")
        let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.appGroup) != nil
        print("Lemma-SELFTEST appGroup \(group ? "available" : "unavailable (unsigned build: widgets won't see the last result)")")
        print("Lemma-SELFTEST link \(LemmaLink.calculate("2+2 = ?").url.absoluteString) -> \(String(describing: LemmaLink(url: LemmaLink.calculate("2+2 = ?").url)))")
    }
}
