import SwiftUI

@main
struct NapkinApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { model.handle($0) }
        }
        .onChange(of: phase) { _, newPhase in
            if newPhase == .active { model.becameActive() }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        WebView(model: model)
            .ignoresSafeArea()
            .background(Theme.paper)
            .sheet(isPresented: $model.showCapture) {
                CaptureSheet()
                    .environmentObject(model)
                    .presentationDetents([.medium, .large])
            }
    }
}

/// 위젯에서 들어오면 웹앱이 뜨기 전에 바로 입력창부터 보여준다
struct CaptureSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("냅킨").font(.headline)
                Spacer()
                Button("닫기") { dismiss() }
            }
            TextEditor(text: $text)
                .focused($focused)
                .font(.system(size: 20))
                .foregroundStyle(Theme.pen)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Theme.chip.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
            Button {
                model.capture(text)
                dismiss()
            } label: {
                Text("적기").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.pen)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(20)
        .onAppear { focused = true }
    }
}
