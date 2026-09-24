import AppIntents
import WidgetKit

/// 앱을 열지 않고 적기: 단축어 · 액션 버튼 · Siri · Spotlight 에서 시스템 입력창이 뜬다
struct AddMemoIntent: AppIntent {
    static let title: LocalizedStringResource = "냅킨에 적기"
    static let description: IntentDescription? = IntentDescription("떠오른 생각을 앱을 열지 않고 바로 적어요.")

    @Parameter(title: "메모", requestValueDialog: IntentDialog("뭐가 떠올랐어요?"))
    var text: String

    init() {}
    init(text: String) { self.text = text }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        SharedStore.addMemo(text)
        WidgetCenter.shared.reloadAllTimelines()
        return .result(dialog: "냅킨에 적었어요")
    }
}

/// 리마인드 위젯: 완료
struct CompleteItemIntent: AppIntent {
    static let title: LocalizedStringResource = "완료"
    static let isDiscoverable = false

    @Parameter(title: "항목") var itemID: String

    init() {}
    init(itemID: String) { self.itemID = itemID }

    func perform() async throws -> some IntentResult {
        SharedStore.record(action: "done", itemID: itemID)
        return .result()
    }
}

/// 리마인드 위젯: 내일 아침에 다시
struct SnoozeItemIntent: AppIntent {
    static let title: LocalizedStringResource = "내일 다시"
    static let isDiscoverable = false

    @Parameter(title: "항목") var itemID: String

    init() {}
    init(itemID: String) { self.itemID = itemID }

    func perform() async throws -> some IntentResult {
        SharedStore.record(action: "snooze", itemID: itemID)
        return .result()
    }
}

/// 리마인드 위젯: 다른 거 보기
struct NextItemIntent: AppIntent {
    static let title: LocalizedStringResource = "다른 거"
    static let isDiscoverable = false

    init() {}

    func perform() async throws -> some IntentResult {
        SharedStore.cursor += 1
        return .result()
    }
}
