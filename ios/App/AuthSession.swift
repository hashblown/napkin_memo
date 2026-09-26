import AuthenticationServices
import UIKit

/// Google · 카카오 로그인: 앱 안 웹 화면 대신 아이폰 시스템 로그인 창으로 연다.
/// 로그인이 끝나면 napkin://auth-callback?code=… 로 돌아온다.
final class AuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = AuthSession()
    private var session: ASWebAuthenticationSession?

    func start(url: URL, completion: @escaping (URL?) -> Void) {
        let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "napkin") { callback, _ in
            DispatchQueue.main.async { completion(callback) }
        }
        s.presentationContextProvider = self
        s.prefersEphemeralWebBrowserSession = false
        session = s
        s.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
