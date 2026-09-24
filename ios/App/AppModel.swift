import SwiftUI
import WebKit
import WidgetKit

/// 앱의 상태와 웹앱 ↔ 아이폰 연결
@MainActor
final class AppModel: ObservableObject {
    @Published var showCapture = false

    weak var webView: WKWebView?
    private var webReady = false

    // MARK: 들어오는 경로

    func handle(_ url: URL) {
        guard url.scheme == "napkin" else { return }
        switch url.host {
        case "write": showCapture = true
        default: break // napkin://todo 등: 앱만 연다
        }
    }

    func becameActive() {
        Notifications.requestPermissionOnce()
        pushInbox()
    }

    func capture(_ text: String) {
        SharedStore.addMemo(text)
        WidgetCenter.shared.reloadAllTimelines()
        pushInbox()
    }

    // MARK: 앱 → 웹

    /// 앱 밖에서 쌓인 메모 · 위젯 동작을 웹앱에 넘긴다. 웹앱이 'ack' 하면 지운다
    func pushInbox() {
        guard webReady, let webView, let json = SharedStore.pendingPayloadJSON() else { return }
        // 끝의 void 0: Promise 결과를 앱으로 돌려받지 않게
        webView.evaluateJavaScript("window.napkinNative && window.napkinNative.ingest(\(json)); void 0")
    }

    // MARK: 웹 → 앱

    func receive(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "ready":
            webReady = true
            pushInbox()
        case "ack":
            SharedStore.acknowledge(ids: msg["ids"] as? [String] ?? [])
            WidgetCenter.shared.reloadAllTimelines()
        case "snapshot":
            guard let raw = msg["items"],
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let items = try? JSONDecoder().decode([SharedStore.Item].self, from: data) else { return }
            SharedStore.items = items
            WidgetCenter.shared.reloadAllTimelines()
            Notifications.schedule(items)
        case "calendar":
            guard let title = msg["title"] as? String, let at = msg["at"] as? Double else { return }
            CalendarPresenter.present(title: title, date: Date(timeIntervalSince1970: at / 1000), url: msg["url"] as? String, note: msg["note"] as? String)
        default:
            break
        }
    }
}
