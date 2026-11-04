import SwiftUI

@main
struct WersyApp: App {
    @StateObject private var store = ProjectStore()
    @StateObject private var audio = AudioEngine()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(audio)
        }
    }
}

enum AppTab: Hashable { case projects, beat, lyrics }

struct RootView: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    @State private var tab: AppTab = .projects

    var body: some View {
        TabView(selection: $tab) {
            ProjectsView(onOpen: { tab = .beat })
                .tabItem { Label("Projekty", systemImage: "music.note.list") }
                .tag(AppTab.projects)

            Group {
                if let id = store.currentID, store.project(id) != nil {
                    BeatView(projectID: id)
                } else {
                    NoProjectView()
                }
            }
            .tabItem { Label("Bit", systemImage: "waveform") }
            .tag(AppTab.beat)

            Group {
                if let id = store.currentID, store.project(id) != nil {
                    LyricsView(projectID: id)
                } else {
                    NoProjectView()
                }
            }
            .tabItem { Label("Tekst", systemImage: "text.alignleft") }
            .tag(AppTab.lyrics)
        }
        .onChange(of: store.currentID) { _, _ in
            audio.stop()
            if let id = store.currentID, let p = store.project(id) {
                audio.load(project: p, store: store)
            }
        }
    }
}

struct NoProjectView: View {
    var body: some View {
        ContentUnavailableView("Brak projektu",
                               systemImage: "music.note",
                               description: Text("Wybierz albo dodaj piosenkę w zakładce Projekty."))
    }
}
