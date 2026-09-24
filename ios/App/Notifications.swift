import UserNotifications

/// 앱이 꺼져 있어도 울리는 알림: 웹앱이 보낸 '챙길 것' 목록으로 예약한다
enum Notifications {
    private static var asked = false

    static func requestPermissionOnce() {
        guard !asked else { return }
        asked = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func schedule(_ items: [SharedStore.Item]) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        let now = Date()
        let upcoming = items
            .compactMap { item in item.dueDate.map { (item, $0) } }
            .filter { $0.1 > now }
            .sorted { $0.1 < $1.1 }
            .prefix(60) // iOS는 앱당 예약 알림 64개까지
        for (item, date) in upcoming {
            let content = UNMutableNotificationContent()
            content.title = item.kind == "link" ? "다시 볼 링크" : "할 일"
            content.body = item.title
            content.sound = .default
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let request = UNNotificationRequest(
                identifier: "\(item.id)-\(Int(date.timeIntervalSince1970))",
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            )
            center.add(request)
        }
    }
}
