import Foundation

/// The last answer Siri/Shortcuts worked out, shown on the home and lock screen widgets.
/// Lives in the App Group container so the widget extension can read it. Without the App Group
/// entitlement (unsigned builds) it falls back to the process's own defaults, and widgets show no result.
struct LastResult: Codable, Equatable {
    var query: String
    var display: String
    var date: Date
}

enum SharedStore {
    static let appGroup = "group.app.lemma.mobile"
    private static let key = "lemma.lastResult"

    static var defaults: UserDefaults {
        // A suite only works when the App Group is actually provisioned for this process.
        if FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil,
           let d = UserDefaults(suiteName: appGroup) {
            return d
        }
        return .standard
    }

    static var lastResult: LastResult? {
        get {
            guard let data = defaults.data(forKey: key) else { return nil }
            return try? JSONDecoder().decode(LastResult.self, from: data)
        }
        set {
            if let v = newValue, let data = try? JSONEncoder().encode(v) {
                defaults.set(data, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }
    }
}
