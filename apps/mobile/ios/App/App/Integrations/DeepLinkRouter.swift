import Capacitor
import UIKit
import WebKit

/// Routes lemma:// links (widgets, controls, share extension, App Intents) into the Capacitor web view by
/// loading the web app with ?q=<query> or ?listen=1, which apps/web/src/main.ts already understands.
/// A link that arrives before the web view exists (cold start) is held and applied once it has loaded.
@MainActor
final class DeepLinkRouter {
    static let shared = DeepLinkRouter()

    weak var bridgeViewController: LemmaBridgeViewController?
    private var pending: LemmaLink?

    /// Returns true when the URL was an Lemma deep link.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let link = LemmaLink(url: url) else { return false }
        open(link)
        return true
    }

    func open(_ link: LemmaLink) {
        guard let vc = bridgeViewController, vc.isViewLoaded, vc.webView != nil else {
            pending = link
            return
        }
        apply(link, to: vc)
    }

    /// Called by the bridge view controller once its web view is set up.
    func bridgeDidLoad(_ vc: LemmaBridgeViewController) {
        bridgeViewController = vc
        if let link = pending {
            pending = nil
            apply(link, to: vc)
        }
    }

    private func apply(_ link: LemmaLink, to vc: LemmaBridgeViewController) {
        guard let webView = vc.webView, let start = vc.bridge?.config.appStartServerURL else { return }
        let url: URL
        switch link {
        case .open:
            // Already showing the calculator: keep its state; only (re)load if nothing is loaded yet.
            if webView.url != nil { return }
            url = start
        case .calculate(let q):
            url = Self.url(start, query: [URLQueryItem(name: "q", value: q)])
        case .listen:
            url = Self.url(start, query: [URLQueryItem(name: "listen", value: "1")])
        }
        webView.load(URLRequest(url: url))
    }

    static func url(_ base: URL, query: [URLQueryItem]) -> URL {
        var c = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        c.queryItems = query
        // "+" is a space to URLSearchParams; keep a literal plus ("2+2") as %2B.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return c.url ?? base
    }
}

/// CAPBridgeViewController that tells the deep-link router when the web view is ready.
class LemmaBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        DeepLinkRouter.shared.bridgeDidLoad(self)
    }
}
