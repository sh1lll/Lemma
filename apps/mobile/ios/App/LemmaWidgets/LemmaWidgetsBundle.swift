import SwiftUI
import WidgetKit

@main
struct LemmaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        CalculatorWidget()
        VoiceWidget()
        if #available(iOS 18.0, *) {
            CalculatorControl()
            VoiceControl()
        }
    }
}
