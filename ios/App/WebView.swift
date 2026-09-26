import SwiftUI
import WebKit

/// 배포된 웹앱을 띄우는 화면. 저장된 메모는 이 웹뷰의 저장소(기기 안)에 남는다
struct WebView: UIViewRepresentable {
    let model: AppModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        // 순환 참조를 피하려고 약한 참조 중계자를 둔다
        config.userContentController.add(WeakMessageHandler(context.coordinator), name: "napkin")

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // 확대 · 가로 스크롤 없이 세로 스크롤만
        web.scrollView.delegate = context.coordinator
        web.scrollView.minimumZoomScale = 1
        web.scrollView.maximumZoomScale = 1
        web.scrollView.bouncesZoom = false
        web.scrollView.alwaysBounceHorizontal = false
        web.scrollView.showsHorizontalScrollIndicator = false
        web.allowsBackForwardNavigationGestures = false
        #if DEBUG
        web.isInspectable = true // 맥 사파리 › 개발 메뉴에서 디버깅
        #endif
        model.webView = web

        let address = Bundle.main.object(forInfoDictionaryKey: "NapkinWebURL") as? String ?? ""
        if let url = URL(string: address) { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
        let model: AppModel
        init(model: AppModel) { self.model = model }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            let body = message.body
            Task { @MainActor in model.receive(body) }
        }

        /// 두 손가락으로 벌려도 확대되지 않게
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }

        /// 가로로 밀려도 제자리
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            if scrollView.contentOffset.x != 0 { scrollView.contentOffset.x = 0 }
        }

        /// 다른 사이트 링크는 사파리 등 바깥에서 연다
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url, url.host != webView.url?.host {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        /// target="_blank" 링크
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
