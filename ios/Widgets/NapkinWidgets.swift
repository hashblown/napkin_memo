import SwiftUI
import WidgetKit
import AppIntents

@main
struct NapkinWidgets: WidgetBundle {
    var body: some Widget {
        CaptureWidget()
        RemindWidget()
    }
}

// MARK: - ① 바로 적기

struct CaptureEntry: TimelineEntry { let date: Date }

struct CaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> CaptureEntry { CaptureEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (CaptureEntry) -> Void) { completion(CaptureEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CaptureEntry>) -> Void) {
        completion(Timeline(entries: [CaptureEntry(date: Date())], policy: .never))
    }
}

struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CaptureWidget", provider: CaptureProvider()) { _ in
            CaptureView()
                .widgetURL(URL(string: "napkin://write"))
                .containerBackground(for: .widget) { Theme.paper }
        }
        .configurationDisplayName("바로 적기")
        .description("탭하면 바로 입력창이 열려요.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct CaptureView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil").font(.title2)
            }
        case .accessoryRectangular:
            Label("napkin에 적기", systemImage: "square.and.pencil").font(.headline)
        default:
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Theme.pen)
                Spacer()
                Text("떠오른 걸\n바로 적기")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.ink)
                // 냅킨 줄
                Rectangle().fill(Theme.chip).frame(height: 1).padding(.top, 8)
                Text("napkin")
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - ② 리마인드

struct RemindEntry: TimelineEntry {
    let date: Date
    let item: SharedStore.Item?
    let position: Int
    let total: Int
}

struct RemindProvider: TimelineProvider {
    func placeholder(in context: Context) -> RemindEntry {
        RemindEntry(date: Date(), item: .init(id: "p", kind: "todo", title: "임대차계약서 서류 확인", detail: "서류를 한 곳에 모아 두기", due: nil, url: nil), position: 0, total: 3)
    }

    func getSnapshot(in context: Context, completion: @escaping (RemindEntry) -> Void) {
        completion(entry(at: Date()))
    }

    /// 지금 + 앞으로 기한이 되는 시각마다 항목을 다시 고른다
    func getTimeline(in context: Context, completion: @escaping (Timeline<RemindEntry>) -> Void) {
        let now = Date()
        let dueTimes = SharedStore.items.compactMap(\.dueDate).filter { $0 > now && $0 < now.addingTimeInterval(86_400) }
        let dates = [now] + Array(Set(dueTimes)).sorted().prefix(20)
        completion(Timeline(entries: dates.map(entry(at:)), policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func entry(at date: Date) -> RemindEntry {
        let list = SharedStore.visibleItems(at: date)
        guard !list.isEmpty else { return RemindEntry(date: date, item: nil, position: 0, total: 0) }
        let i = ((SharedStore.cursor % list.count) + list.count) % list.count
        return RemindEntry(date: date, item: list[i], position: i, total: list.count)
    }
}

struct RemindWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RemindWidget", provider: RemindProvider()) { entry in
            RemindView(entry: entry)
                .containerBackground(for: .widget) { Theme.paper }
        }
        .configurationDisplayName("챙길 것")
        .description("적어둔 것 중 지금 챙길 것을 보여주고, 바로 완료하거나 미룰 수 있어요.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct RemindView: View {
    let entry: RemindEntry
    @Environment(\.widgetFamily) private var family

    private var tapURL: URL? {
        if let s = entry.item?.url, let url = URL(string: s) { return url }
        return URL(string: entry.item == nil ? "napkin://write" : "napkin://todo")
    }

    var body: some View {
        Group {
            if family == .accessoryRectangular {
                lockScreen
            } else if let item = entry.item {
                content(item)
            } else {
                empty
            }
        }
        .widgetURL(tapURL)
    }

    private var lockScreen: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.item.map { $0.kind == "link" ? "🔗 다시 볼 것" : "☐ 챙길 것" } ?? "napkin").font(.caption2)
            Text(entry.item?.title ?? "챙길 게 없어요").font(.headline).lineLimit(2)
            if let due = DueText.label(entry.item?.dueDate, now: entry.date) { Text(due).font(.caption2) }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("챙길 것").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            Spacer()
            Text("지금은 없어요 🙌").font(.headline).foregroundStyle(Theme.ink)
            Text("탭해서 적기").font(.caption).foregroundStyle(Theme.pen)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func content(_ item: SharedStore.Item) -> some View {
        let overdue = (item.dueDate ?? .distantFuture) <= entry.date
        let medium = family == .systemMedium
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(item.kind == "link" ? "🔗 다시 볼 것" : item.due == nil ? "👉 하나 해볼까요" : "☐ 할 일")
                Spacer(minLength: 0)
                if entry.total > 1 { Text("\(entry.position + 1)/\(entry.total)").monospacedDigit() }
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Theme.muted)

            Text(item.title)
                .font(.system(size: medium ? 17 : 15, weight: .bold))
                .foregroundStyle(Theme.ink)
                .lineLimit(medium ? 2 : 3)

            if let due = DueText.label(item.dueDate, now: entry.date) {
                Text(due).font(.caption).foregroundStyle(overdue ? Theme.danger : Theme.pen)
            } else if let detail = item.detail, !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
            }

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                Button(intent: CompleteItemIntent(itemID: item.id)) {
                    Label(item.kind == "link" ? "봤어요" : "완료", systemImage: "checkmark")
                }
                .tint(Theme.pen)
                Button(intent: SnoozeItemIntent(itemID: item.id)) {
                    Label("내일 다시", systemImage: "clock.arrow.circlepath")
                }
                if entry.total > 1 {
                    Button(intent: NextItemIntent()) {
                        Label("다른 거", systemImage: "arrow.right")
                    }
                }
            }
            .labelStyle(ButtonLabel(showTitle: medium))
            .buttonStyle(.bordered)
            .font(.caption.weight(.semibold))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 작은 위젯은 아이콘만, 중간 위젯은 글자까지
struct ButtonLabel: LabelStyle {
    let showTitle: Bool
    @ViewBuilder
    func makeBody(configuration: Configuration) -> some View {
        if showTitle {
            HStack(spacing: 3) { configuration.icon; configuration.title }
        } else {
            configuration.icon
        }
    }
}
