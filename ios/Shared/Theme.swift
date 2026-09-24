import SwiftUI
import UIKit

/// 카페 테이블(원목) 위 종이 + 볼펜(파란 잉크). 다크 모드는 어두운 월넛 테이블
enum Theme {
    static let paper = dynamic(light: 0xFFFCF6, dark: 0x2B2520)
    static let table = dynamic(light: 0x8A5D3B, dark: 0x2E2118)
    static let ink = dynamic(light: 0x2A2420, dark: 0xEFE6DA)
    static let muted = dynamic(light: 0x7B6E60, dark: 0xB0A393)
    static let pen = dynamic(light: 0x2446A8, dark: 0x8FA8F5)
    static let chip = dynamic(light: 0xF2E9DA, dark: 0x463B30)
    static let danger = dynamic(light: 0xC0392B, dark: 0xF08070)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

enum DueText {
    /// "지금", "오늘 15:00", "내일 09:00", "9/30 09:00"
    static func label(_ date: Date?, now: Date = Date()) -> String? {
        guard let date else { return nil }
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "HH:mm"
        let time = f.string(from: date)
        if date <= now { return cal.isDateInToday(date) ? "오늘 \(time) · 지남" : "기한 지남" }
        if cal.isDateInToday(date) { return "오늘 \(time)" }
        if cal.isDateInTomorrow(date) { return "내일 \(time)" }
        f.dateFormat = "M/d HH:mm"
        return f.string(from: date)
    }
}
