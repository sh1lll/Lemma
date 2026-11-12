import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Lemma" in the share sheet for selected text. Simple maths is answered right here by the bundled
/// calculator, with a button to continue in the app; anything else opens Lemma at ?q=<text> straight away.
final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        let host = UIHostingController(rootView: ShareCard(model: model, onOpen: { [weak self] in self?.openInApp() }, onDone: { [weak self] in self?.finish() }))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)

        Task { @MainActor in
            let text = await Self.sharedText(from: extensionContext)
            model.text = text
            guard let text, !text.isEmpty else {
                model.state = .nothing
                return
            }
            let answer = await Task.detached { InlineCalculator.shared.answer(text) }.value
            if answer.ok, answer.display != nil {
                model.state = .answered(answer)
            } else {
                model.state = .opening
                openInApp()
            }
        }
    }

    private func openInApp() {
        guard let text = model.text, !text.isEmpty else { return finish() }
        let url = LemmaLink.calculate(text).url
        _ = openURL(url)
        finish()
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    /// Extensions can't call UIApplication.shared.open; walk the responder chain to the host UIApplication and
    /// call open(_:options:completionHandler:) through the runtime (the long-standing share-extension approach;
    /// iOS 18 removed the older single-argument openURL:).
    private func openURL(_ url: URL) -> Bool {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication, let method = class_getInstanceMethod(UIApplication.self, selector) {
                typealias OpenFn = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
                let fn = unsafeBitCast(method_getImplementation(method), to: OpenFn.self)
                fn(app, selector, url as NSURL, NSDictionary(), nil)
                return true
            }
            responder = r.next
        }
        return false
    }

    /// The first plain text (or a URL's text) among the shared items.
    private static func sharedText(from context: NSExtensionContext?) async -> String? {
        let items = (context?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let s = await load(provider, type: UTType.plainText) {
                    return clean(s)
                }
            }
            if let s = item.attributedContentText?.string, !s.isEmpty { return clean(s) }
        }
        return nil
    }

    private static func load(_ provider: NSItemProvider, type: UTType) async -> String? {
        await withCheckedContinuation { cont in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { item, _ in
                switch item {
                case let s as String: cont.resume(returning: s)
                case let s as NSAttributedString: cont.resume(returning: s.string)
                case let d as Data: cont.resume(returning: String(data: d, encoding: .utf8))
                case let u as URL: cont.resume(returning: (try? String(contentsOf: u, encoding: .utf8)) ?? u.absoluteString)
                default: cont.resume(returning: nil)
                }
            }
        }
    }

    private static func clean(_ s: String) -> String {
        let oneLine = s.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        return String(oneLine.prefix(LemmaLink.maxQueryLength))
    }
}

@MainActor
final class ShareModel: ObservableObject {
    enum State { case loading, answered(InlineCalculator.Answer), opening, nothing }
    @Published var text: String?
    @Published var state: State = .loading
}

struct ShareCard: View {
    @ObservedObject var model: ShareModel
    var onOpen: () -> Void
    var onDone: () -> Void

    var body: some View {
        VStack {
            Spacer()
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Lemma", systemImage: "plus.forwardslash.minus").font(.headline)
                    Spacer()
                    Button("Done", action: onDone)
                }
                switch model.state {
                case .loading, .opening:
                    ProgressView().frame(maxWidth: .infinity)
                case .nothing:
                    Text("No text to calculate.").foregroundStyle(.secondary)
                case .answered(let a):
                    Text(a.expression ?? model.text ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                    Text("\(a.approximate == true ? "≈" : "=") \(a.display ?? "")")
                        .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                        .lineLimit(2).minimumScaleFactor(0.4)
                        .textSelection(.enabled)
                    HStack {
                        Button {
                            UIPasteboard.general.string = a.display
                        } label: { Label("Copy", systemImage: "doc.on.doc") }
                            .buttonStyle(.bordered)
                        Spacer()
                        Button(action: onOpen) { Label("Open in Lemma", systemImage: "arrow.up.forward.app") }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding(20)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding()
        }
    }
}
