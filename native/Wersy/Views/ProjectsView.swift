import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject var store: ProjectStore
    var onOpen: () -> Void
    @State private var showNew = false
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.projects) { p in
                    Button {
                        store.currentID = p.id
                        onOpen()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(p.name).font(.headline)
                                Text(subtitle(p)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if store.currentID == p.id {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                            }
                        }
                    }
                    .foregroundStyle(.primary)
                }
                .onDelete { idx in
                    idx.map { store.projects[$0].id }.forEach(store.delete)
                }
            }
            .overlay {
                if store.projects.isEmpty {
                    ContentUnavailableView("Brak piosenek", systemImage: "music.mic",
                                           description: Text("Dodaj nowy projekt przyciskiem +"))
                }
            }
            .navigationTitle("Projekty")
            .toolbar {
                Button { newName = ""; showNew = true } label: { Image(systemName: "plus") }
            }
            .alert("Nowa piosenka", isPresented: $showNew) {
                TextField("Nazwa", text: $newName)
                Button("Anuluj", role: .cancel) {}
                Button("Dodaj") {
                    let p = store.create(name: newName)
                    store.currentID = p.id
                    onOpen()
                }
            }
        }
    }

    private func subtitle(_ p: Project) -> String {
        guard p.beatFileName != nil else { return "Bez bitu" }
        let lines = p.sections.reduce(0) { $0 + $1.barCount }
        return "\(Int(p.bpm.rounded())) BPM · \(p.barCount) taktów · \(lines) wersów"
    }
}
