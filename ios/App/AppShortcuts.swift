import AppIntents

/// 단축어 앱 · 액션 버튼 · Siri · Spotlight 에 'napkin에 적기'를 등록한다
struct NapkinShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddMemoIntent(),
            phrases: [
                "\(.applicationName)에 적기",
                "\(.applicationName) 메모",
            ],
            shortTitle: "napkin에 적기",
            systemImageName: "square.and.pencil"
        )
    }
}
