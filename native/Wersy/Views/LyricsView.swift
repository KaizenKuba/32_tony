import SwiftUI

/// Zakładka Tekst: każdy takt sekcji = jeden wers, numeracja „takt bezwzględny · numer wersu”.
struct LyricsView: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    let projectID: UUID
    @State private var follow = true

    private var project: Binding<Project> { store.binding(projectID) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if project.wrappedValue.sections.isEmpty {
                    ContentUnavailableView("Brak sekcji", systemImage: "rectangle.split.3x1",
                                           description: Text("W zakładce Bit zaznacz takty i oznacz je jako intro, zwrotkę, refren…"))
                } else {
                    ScrollViewReader { proxy in
                        List {
                            ForEach(project.sections) { $section in
                                Section {
                                    ForEach(section.lines.indices, id: \.self) { i in
                                        LineRow(line: $section.lines[i],
                                                absoluteBar: section.startBar + i,
                                                lineNumber: i + 1,
                                                isCurrent: isCurrent(section.startBar + i))
                                        .id(section.startBar + i)
                                    }
                                } header: {
                                    HStack {
                                        Circle().fill(section.kind.color).frame(width: 10, height: 10)
                                        Text(section.title)
                                        Spacer()
                                        Text("\(section.barCount) wersów").font(.caption)
                                    }
                                }
                            }
                        }
                        .listStyle(.plain)
                        .scrollDismissesKeyboard(.interactively)
                        .onChange(of: currentBar) { _, bar in
                            guard follow, audio.isPlaying, let bar else { return }
                            withAnimation { proxy.scrollTo(bar, anchor: .center) }
                        }
                    }
                }
                TransportBar(projectID: projectID)
            }
            .navigationTitle(project.wrappedValue.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Toggle(isOn: $follow) { Image(systemName: "scope") }
                    .toggleStyle(.button)
                    .help("Przewijaj za odtwarzaniem")
            }
        }
    }

    private var currentBar: Int? {
        audio.isPlaying ? project.wrappedValue.bar(at: audio.position) : nil
    }

    private func isCurrent(_ bar: Int) -> Bool { currentBar == bar }
}

struct LineRow: View {
    @Binding var line: Line
    let absoluteBar: Int
    let lineNumber: Int
    let isCurrent: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(absoluteBar)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Text("\(lineNumber)").font(.headline.monospacedDigit())
            }
            .frame(width: 34, alignment: .trailing)
            .padding(.top, 4)

            VStack(alignment: .leading, spacing: 6) {
                ForEach($line.versions) { $v in
                    HStack(alignment: .top, spacing: 8) {
                        if v.visible {
                            TextField("Wers \(lineNumber)…", text: $v.text, axis: .vertical)
                                .lineLimit(1...4)
                        } else {
                            Text(v.text.isEmpty ? "ukryta wersja" : v.text)
                                .lineLimit(1)
                                .foregroundStyle(.tertiary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Button { v.visible.toggle() } label: {
                            Image(systemName: v.visible ? "eye" : "eye.slash")
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                        Button(role: .destructive) { delete(v.id) } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .disabled(line.versions.count <= 1)
                    }
                }
                Button {
                    line.versions.append(LineVersion())
                } label: {
                    Label("Wersja", systemImage: "plus").font(.caption)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(isCurrent ? Color.green.opacity(0.15) : Color.clear)
    }

    private func delete(_ id: UUID) {
        guard line.versions.count > 1 else { return }
        line.versions.removeAll { $0.id == id }
    }
}
