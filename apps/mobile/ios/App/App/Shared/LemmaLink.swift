import Foundation

/// Deep links into the app, shared by the app, its widgets/controls and the share extension.
///
///   lemma://calc?q=18%25%20tip%20on%2064   open the calculator and run a question (web app's ?q=)
///   lemma://calc                            just open the calculator
///   lemma://listen                          open and start a voice calculation (web app's ?listen=1)
///
/// The scheme is case-insensitive, so Lemma://calc?q=… works too.
enum LemmaLink: Equatable {
    case open
    case calculate(String)
    case listen

    static let scheme = "lemma"
    static let maxQueryLength = 500

    var url: URL {
        var c = URLComponents()
        c.scheme = Self.scheme
        switch self {
        case .open:
            c.host = "calc"
        case .calculate(let q):
            c.host = "calc"
            c.queryItems = [URLQueryItem(name: "q", value: String(q.prefix(Self.maxQueryLength)))]
        case .listen:
            c.host = "listen"
        }
        return c.url!
    }

    init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = c?.queryItems ?? []
        // Host or first path segment: lemma://calc, lemma:calc, lemma:///calc.
        let route = (url.host ?? url.pathComponents.first(where: { $0 != "/" }) ?? "").lowercased()
        if route == "listen" || route == "voice" || items.contains(where: { $0.name == "listen" }) {
            self = .listen
            return
        }
        let q = items.first(where: { $0.name == "q" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self = q.isEmpty ? .open : .calculate(String(q.prefix(Self.maxQueryLength)))
    }
}
