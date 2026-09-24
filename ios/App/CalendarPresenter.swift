import EventKit
import EventKitUI
import UIKit

/// 📅 버튼: 알림이 달린 일정을 채운 기본 캘린더 편집 화면을 띄운다 (저장은 사용자가 확인)
@MainActor
enum CalendarPresenter {
    private static let store = EKEventStore()
    private static let delegate = Delegate()

    static func present(title: String, date: Date, url: String?, note: String?) {
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = date
        event.endDate = date.addingTimeInterval(30 * 60)
        event.notes = note
        if let url { event.url = URL(string: url) }
        event.addAlarm(EKAlarm(relativeOffset: 0))

        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = event
        editor.editViewDelegate = delegate
        topController()?.present(editor, animated: true)
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    private final class Delegate: NSObject, EKEventEditViewDelegate {
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            controller.dismiss(animated: true)
        }
    }
}
