import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline

struct LemmaEntry: TimelineEntry {
    var date: Date
    var last: LastResult?
}

struct LemmaProvider: TimelineProvider {
    func placeholder(in context: Context) -> LemmaEntry {
        LemmaEntry(date: Date(), last: LastResult(query: "18% tip on 64", display: "$11.52", date: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (LemmaEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : LemmaEntry(date: Date(), last: SharedStore.lastResult))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LemmaEntry>) -> Void) {
        // The app reloads timelines whenever it stores a new result; nothing changes on a schedule.
        completion(Timeline(entries: [LemmaEntry(date: Date(), last: SharedStore.lastResult)], policy: .never))
    }
}

private let brand = Color(red: 0.36, green: 0.42, blue: 1.0)

// MARK: - Calculator widget (home screen small/medium, lock screen)

struct CalculatorWidget: Widget {
    let kind = "LemmaCalculator"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LemmaProvider()) { entry in
            CalculatorWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Calculate")
        .description("Open Lemma in one tap, or speak a calculation. Shows your last Siri answer.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct CalculatorWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: LemmaEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "plus.forwardslash.minus").font(.title2.weight(.semibold))
            }
            .widgetURL(LemmaLink.open.url)
            .accessibilityLabel("Open Lemma")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label("Lemma", systemImage: "plus.forwardslash.minus").font(.headline).widgetAccentable()
                if let last = entry.last {
                    Text(last.query).font(.caption).lineLimit(1).foregroundStyle(.secondary)
                    Text("= \(last.display)").font(.body.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.6)
                } else {
                    Text("Tap to calculate").font(.body)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(LemmaLink.open.url)
        case .accessoryInline:
            Label(entry.last.map { "\($0.query) = \($0.display)" } ?? "Calculate", systemImage: "plus.forwardslash.minus")
                .widgetURL(LemmaLink.open.url)
        case .systemMedium:
            MediumView(entry: entry)
        default:
            SmallView(entry: entry)
        }
    }
}

private struct LastResultView: View {
    var last: LastResult?
    var body: some View {
        if let last {
            VStack(alignment: .leading, spacing: 2) {
                Text(last.query).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(last.display).font(.system(.title2, design: .rounded).weight(.semibold)).lineLimit(1).minimumScaleFactor(0.5)
            }
        } else {
            Text("Ask anything:\n“18% tip on 64”").font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
    }
}

private struct SmallView: View {
    var entry: LemmaEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "plus.forwardslash.minus").font(.headline).foregroundStyle(brand)
                Spacer()
                // Small widgets have one tap target, except intent buttons: this one opens voice.
                Button(intent: OpenVoiceCalculationIntent()) {
                    Image(systemName: "mic.fill").font(.headline)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
                .tint(brand)
                .accessibilityLabel("Speak a calculation")
            }
            Spacer(minLength: 0)
            LastResultView(last: entry.last)
            Text("Calculate").font(.headline)
        }
        .widgetURL(LemmaLink.open.url)
    }
}

private struct MediumView: View {
    var entry: LemmaEntry
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Label("Lemma", systemImage: "plus.forwardslash.minus").font(.headline).foregroundStyle(brand)
                Spacer(minLength: 0)
                LastResultView(last: entry.last)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 8) {
                Link(destination: LemmaLink.open.url) {
                    ActionPill(title: "Calculate", systemImage: "keyboard")
                }
                Link(destination: LemmaLink.listen.url) {
                    ActionPill(title: "Speak", systemImage: "mic.fill")
                }
            }
            .frame(width: 130)
        }
    }
}

private struct ActionPill: View {
    var title: String
    var systemImage: String
    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .foregroundStyle(.white)
            .background(brand, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Voice widget (lock screen circular, home screen small)

struct VoiceWidget: Widget {
    let kind = "LemmaVoice"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LemmaProvider()) { _ in
            VoiceWidgetView()
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Voice Calculation")
        .description("Speak a calculation to Lemma.")
        .supportedFamilies([.accessoryCircular, .systemSmall])
    }
}

struct VoiceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        Group {
            if family == .accessoryCircular {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "mic.fill").font(.title2.weight(.semibold))
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "mic.circle.fill").font(.system(size: 56)).foregroundStyle(brand)
                    Text("Speak").font(.headline)
                }
            }
        }
        .widgetURL(LemmaLink.listen.url)
        .accessibilityLabel("Speak a calculation to Lemma")
    }
}
