import Foundation

/// 앱 · 위젯 · 공유 확장이 함께 쓰는 저장소 (App Group).
/// - 받은편지함: 앱 밖(위젯 · 단축어 · 공유)에서 적은 메모와 위젯에서 누른 동작. 앱을 열면 웹앱이 가져간다.
/// - 챙길 것 목록: 웹앱이 보내준 할 일 · 리마인드. 위젯과 알림이 읽는다.
enum SharedStore {
    static let groupID = "group.com.hashblown.napkin"
    static var defaults: UserDefaults { UserDefaults(suiteName: groupID) ?? .standard }

    struct InboxMemo: Codable { let id: String; let text: String; let at: Double }
    struct PendingAction: Codable { let id: String; let itemID: String; let action: String; let at: Double }

    struct Item: Codable, Hashable, Identifiable {
        let id: String
        let kind: String      // "todo" | "link"
        let title: String
        let detail: String?
        let due: Double?      // ms. nil이면 기한 없는 할 일
        let url: String?

        var dueDate: Date? { due.map { Date(timeIntervalSince1970: $0 / 1000) } }
    }

    private enum Key {
        static let memos = "inbox.memos"
        static let actions = "inbox.actions"
        static let items = "widget.items"
        static let hidden = "widget.hidden"
        static let cursor = "widget.cursor"
    }

    private static func load<T: Decodable>(_ key: String, as type: T.Type) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func store<T: Encodable>(_ value: T, _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }

    private static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

    // MARK: 받은편지함

    static func addMemo(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var memos = load(Key.memos, as: [InboxMemo].self) ?? []
        memos.append(InboxMemo(id: UUID().uuidString, text: trimmed, at: nowMs))
        store(memos, Key.memos)
    }

    /// 위젯에서 완료 · 내일 다시를 누르면: 받은편지함에 쌓고, 위젯에서는 바로 숨긴다
    static func record(action: String, itemID: String) {
        var actions = load(Key.actions, as: [PendingAction].self) ?? []
        actions.append(PendingAction(id: UUID().uuidString, itemID: itemID, action: action, at: nowMs))
        store(actions, Key.actions)

        var hidden = load(Key.hidden, as: [String: Double].self) ?? [:]
        hidden[itemID] = action == "done" ? Double.greatestFiniteMagnitude : tomorrowMorning().timeIntervalSince1970 * 1000
        store(hidden, Key.hidden)
    }

    static var hasPending: Bool {
        !(load(Key.memos, as: [InboxMemo].self) ?? []).isEmpty || !(load(Key.actions, as: [PendingAction].self) ?? []).isEmpty
    }

    /// 웹앱에 넘길 JSON: { memos: [...], actions: [...] }
    static func pendingPayloadJSON() -> String? {
        let memos = load(Key.memos, as: [InboxMemo].self) ?? []
        let actions = load(Key.actions, as: [PendingAction].self) ?? []
        guard !memos.isEmpty || !actions.isEmpty else { return nil }
        struct Payload: Encodable { let memos: [InboxMemo]; let actions: [PendingAction] }
        guard let data = try? JSONEncoder().encode(Payload(memos: memos, actions: actions)) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// 웹앱이 반영했다고 알려준 항목을 지운다
    static func acknowledge(ids: [String]) {
        let done = Set(ids)
        store((load(Key.memos, as: [InboxMemo].self) ?? []).filter { !done.contains($0.id) }, Key.memos)
        store((load(Key.actions, as: [PendingAction].self) ?? []).filter { !done.contains($0.id) }, Key.actions)
    }

    // MARK: 챙길 것 목록

    static var items: [Item] {
        get { load(Key.items, as: [Item].self) ?? [] }
        set {
            store(newValue, Key.items)
            // 웹앱에 이미 반영된 동작은 웹앱 목록이 알아서 반영하므로, 아직 안 넘어간 것만 숨김 유지
            let pendingIDs = Set((load(Key.actions, as: [PendingAction].self) ?? []).map(\.itemID))
            let hidden = (load(Key.hidden, as: [String: Double].self) ?? [:]).filter { pendingIDs.contains($0.key) }
            store(hidden, Key.hidden)
        }
    }

    /// 주어진 시각에 위젯에 보여줄 순서: 기한 된 것 → 기한 없는 할 일 → 곧 올 것
    static func visibleItems(at date: Date = Date()) -> [Item] {
        let t = date.timeIntervalSince1970 * 1000
        let hidden = load(Key.hidden, as: [String: Double].self) ?? [:]
        let live = items.filter { (hidden[$0.id] ?? 0) <= t }
        let due = live.filter { ($0.due ?? .infinity) <= t }.sorted { ($0.due ?? 0) < ($1.due ?? 0) }
        let undated = live.filter { $0.due == nil }
        let upcoming = live.filter { ($0.due ?? 0) > t }.sorted { ($0.due ?? 0) < ($1.due ?? 0) }
        return due + undated + upcoming
    }

    /// 위젯의 '다른 거' 버튼이 넘기는 위치
    static var cursor: Int {
        get { defaults.integer(forKey: Key.cursor) }
        set { defaults.set(newValue, forKey: Key.cursor) }
    }

    static func tomorrowMorning() -> Date {
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return cal.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }
}
