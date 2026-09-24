import UIKit
import UniformTypeIdentifiers
import WidgetKit

/// 공유 메뉴의 'napkin': 링크 · 글을 받아 받은편지함에 넣고 바로 닫힌다
final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        label.text = "napkin에 담는 중…"
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textAlignment = .center
        label.backgroundColor = .secondarySystemBackground
        label.layer.cornerRadius = 14
        label.clipsToBounds = true
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(equalToConstant: 220),
            label.heightAnchor.constraint(equalToConstant: 64),
        ])
        Task { await collect() }
    }

    private func collect() async {
        var parts: [String] = []
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            if let title = item.attributedContentText?.string, !title.isEmpty { parts.append(title) }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    parts.append(url.absoluteString)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    parts.append(text)
                }
            }
        }
        // 같은 내용이 제목과 본문에 겹쳐 오는 경우가 많아 중복 제거
        var seen = Set<String>()
        let text = parts.filter { seen.insert($0).inserted }.joined(separator: "\n")
        SharedStore.addMemo(text)
        WidgetCenter.shared.reloadAllTimelines()
        await MainActor.run { label.text = text.isEmpty ? "담을 내용이 없어요" : "napkin에 담았어요 ✓" }
        try? await Task.sleep(nanoseconds: 700_000_000)
        await MainActor.run { extensionContext?.completeRequest(returningItems: nil) }
    }
}
